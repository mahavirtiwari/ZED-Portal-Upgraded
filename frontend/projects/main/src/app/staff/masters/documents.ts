import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DocumentRole, DocumentRow, MastersApi } from './masters.api';
import { PagedView, PagerComponent } from '../pager';

/** Same list as the API (MasterUploads.DocumentTypes); the API checks type, content and size again. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.txt', '.jpg', '.jpeg', '.png'];
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const DESCRIPTION_MAX = 300;

/** The document being edited. */
interface DocumentEdit {
  id: number;
  documentName: string;
  description: string;
  videoUrl: string | null;
  roles: Set<string>;
}

/**
 * Admin → Masters → Documents/Videos (V4, as the LEAN portal's page; port of Views/MyDocuments/Index.cshtml): a document
 * is a file or a video link, with a description, given to the account types that may open it (the MSMEs on My
 * Documents and in the apps, staff on their Documents page). Upload and save are one step; the API names the file.
 * Documents from before have no roles set: they go to the MSMEs only, as before.
 */
@Component({
  selector: 'zed-staff-documents',
  imports: [FormsModule, DatePipe, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Documents/Videos</h3>
        <p class="page-sub">Publish documents and videos, and control which roles can access them.</p>
      </div>
      <button type="button" class="btn btn-primary" (click)="focusUpload()">Upload</button>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="zed-card doc-filter">
      <input class="form-control" type="search" placeholder="Search documents..." aria-label="Search documents" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <select class="form-select" aria-label="Role" [ngModel]="roleFilter()" (ngModelChange)="roleFilter.set($event)">
        <option value="">All Roles</option>
        @for (r of roles(); track r.key) { <option [value]="r.key">{{ r.label }}</option> }
      </select>
    </div>

    <section class="zed-card" aria-labelledby="doc-upload-h">
      <h5 class="doc-h" id="doc-upload-h">Upload &amp; Role Assignment</h5>
      <p class="muted">Add the document, then tick the roles that should be able to open it.</p>
      <div class="doc-grid">
        <div>
          <label class="form-label" for="documentName">Document name<span class="req">*</span></label>
          <input #nameInput id="documentName" class="form-control" maxlength="200" placeholder="Enter document name" [(ngModel)]="documentName" />
        </div>
        <div>
          <label class="form-label doc-count-label" for="documentDescription">Description <span class="muted">{{ description.length }} / {{ max }}</span></label>
          <textarea id="documentDescription" class="form-control" rows="3" [attr.maxlength]="max" placeholder="Brief description of the document..." [(ngModel)]="description"></textarea>
        </div>
      </div>

      <span class="form-label">What are you adding?</span>
      <div class="btn-group mb-3" role="group" aria-label="What are you adding?">
        <button type="button" class="btn" [class.btn-primary]="kind() === 'file'" [class.btn-outline-primary]="kind() !== 'file'" [attr.aria-pressed]="kind() === 'file'" (click)="kind.set('file')">Upload a file</button>
        <button type="button" class="btn" [class.btn-primary]="kind() === 'video'" [class.btn-outline-primary]="kind() !== 'video'" [attr.aria-pressed]="kind() === 'video'" (click)="kind.set('video')">Video link</button>
      </div>
      @if (kind() === 'file') {
        <label class="doc-drop" for="fileControl">
          <span class="doc-drop-title">{{ fileName() || 'Choose a file to upload' }}</span>
          <span class="muted">Supported: {{ accept }} (max 5 MB)</span>
          <input #fileInput type="file" id="fileControl" class="visually-hidden" [accept]="accept" (change)="pick($event)" />
        </label>
      } @else {
        <label class="form-label" for="videoUrl">Video link<span class="req">*</span></label>
        <input id="videoUrl" class="form-control" placeholder="Paste the YouTube or hosted video address (https://)" [(ngModel)]="videoUrl" />
        <small class="muted">The video is played from where it is hosted. Nothing is uploaded or stored here.</small>
      }

      <div class="doc-roles">
        <div class="doc-roles-head">
          <div>
            <strong>Role Assignment</strong>
            <p class="muted mb-0">Tick a role to let every user of that account type open the document.</p>
          </div>
          <span class="muted">{{ picked().size }} of {{ roles().length }} selected</span>
          <label class="doc-role doc-all"><input type="checkbox" class="form-check-input" [checked]="picked().size === roles().length && roles().length > 0" (change)="pickAll($any($event.target).checked)" /> Select all</label>
        </div>
        <div class="doc-role-grid">
          @for (r of roles(); track r.key) {
            <label class="doc-role"><input type="checkbox" class="form-check-input" [checked]="picked().has(r.key)" (change)="toggleRole(r.key)" /> {{ r.label }}</label>
          }
        </div>
        <small class="muted">Changes apply the next time each user opens the documents.</small>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save()">Upload</button>
      </div>
    </section>

    <section class="zed-card" aria-labelledby="doc-library-h">
      <h5 class="doc-h" id="doc-library-h">Document Library <span class="zed-chip">{{ shown().length }} document{{ shown().length === 1 ? '' : 's' }}</span></h5>
      @for (d of library.page(); track d.id) {
        <div class="doc-item">
          <div class="doc-item-main">
            <strong>{{ d.documentName }}</strong>
            <span class="zed-chip">{{ d.videoUrl ? 'Video' : 'File' }}</span>
            @if (d.description) { <p class="muted mb-1">{{ d.description }}</p> }
            <div class="doc-chips">
              @for (k of d.roles; track k) { <span class="doc-chip">{{ roleLabel(k) }}</span> }
              @if (d.createdDate) { <span class="doc-added">Added {{ d.createdDate | date: 'dd-MM-yyyy' }}</span> }
            </div>
          </div>
          <div class="row-actions">
            @if (d.videoUrl) {
              <a class="btn btn-sm btn-outline-primary" [href]="d.videoUrl" target="_blank" rel="noopener noreferrer">Watch</a>
            } @else if (d.downloadUrl) {
              <a class="btn btn-sm btn-outline-primary" [href]="d.downloadUrl" target="_blank" rel="noopener">Download</a>
            }
            <button type="button" class="btn btn-sm btn-outline-primary" [attr.aria-label]="'Edit ' + d.documentName" (click)="edit(d)">Edit</button>
            <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="saving()" [attr.aria-label]="'Delete ' + d.documentName" (click)="remove(d)">Delete</button>
          </div>
        </div>
      } @empty {
        <div class="no-data">{{ documents().length ? 'Nothing matches the search and role filter.' : 'No documents published yet. Upload the first one above.' }}</div>
      }
      @if (shown().length) {
        <zed-pager [pager]="library" />
      }
    </section>

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="doc-edit-title">
        <div class="modal-dialog modal-lg modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h4 class="m-0" id="doc-edit-title">Edit document</h4>
              <button type="button" class="btn-close" aria-label="Close" (click)="editing.set(null)"></button>
            </div>
            <div class="modal-body">
              <label class="form-label" for="editName">Document name<span class="req">*</span></label>
              <input id="editName" class="form-control" maxlength="200" [(ngModel)]="e.documentName" />
              <label class="form-label doc-count-label mt-3" for="editDescription">Description <span class="muted">{{ e.description.length }} / {{ max }}</span></label>
              <textarea id="editDescription" class="form-control" rows="3" [attr.maxlength]="max" [(ngModel)]="e.description"></textarea>
              @if (e.videoUrl !== null) {
                <label class="form-label mt-3" for="editVideo">Video link<span class="req">*</span></label>
                <input id="editVideo" class="form-control" [(ngModel)]="e.videoUrl" />
              }
              <span class="form-label mt-3">Roles</span>
              <div class="doc-role-grid">
                @for (r of roles(); track r.key) {
                  <label class="doc-role"><input type="checkbox" class="form-check-input" [checked]="e.roles.has(r.key)" (change)="toggleEditRole(e, r.key)" /> {{ r.label }}</label>
                }
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="editing.set(null)">Cancel</button>
              <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="saveEdit(e)">Save</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (saving()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Saving…</span></div>
    }
  `,
  styles: `
    .page-head { align-items: center; }
    .zed-card { margin-bottom: 16px; }
    .doc-filter { display: grid; grid-template-columns: 1fr 220px; gap: 12px; }
    .doc-h { font-weight: 700; color: #23474a; display: flex; align-items: center; gap: 8px; }
    .doc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 12px; }
    .form-label { display: block; margin-bottom: 4px; }
    .doc-count-label { display: flex; justify-content: space-between; }
    .doc-drop { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 28px 16px; border: 2px dashed #b9d3d5; border-radius: 12px; background: #f8fbfb; cursor: pointer; text-align: center; }
    .doc-drop:hover { border-color: #45a5ad; }
    .doc-drop-title { font-weight: 600; color: #23474a; }
    .doc-roles { margin-top: 16px; padding: 16px; border: 1px solid #dfe9ea; border-radius: 12px; background: #fbfdfd; }
    .doc-roles-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 12px; }
    .doc-roles-head > div { flex: 1; min-width: 220px; }
    .doc-role-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; margin-bottom: 8px; }
    .doc-role { display: flex; align-items: center; gap: 8px; margin: 0; padding: 9px 12px; border: 1px solid #dfe9ea; border-radius: 8px; background: #fff; cursor: pointer; }
    .doc-role .form-check-input { float: none; margin: 0; flex: none; }
    .doc-all { font-weight: 600; }
    .doc-item { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 0; border-top: 1px solid #eef3f3; }
    .doc-item-main { flex: 1; min-width: 240px; }
    .doc-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .doc-chip { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: #eef6f6; color: #2f7c83; }
    .doc-added { font-size: 12px; color: #5f6f70; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 700px) { .doc-filter, .doc-grid { grid-template-columns: 1fr; } }
  `,
})
export class DocumentsAdminPage {
  private readonly api = inject(MastersApi);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly accept = DOCUMENT_EXTENSIONS.join(',');
  protected readonly max = DESCRIPTION_MAX;
  protected readonly documents = signal<DocumentRow[]>([]);
  protected readonly roles = signal<DocumentRole[]>([]);
  protected readonly search = signal('');
  protected readonly roleFilter = signal('');
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const role = this.roleFilter();
    return this.documents().filter((d) =>
      (!q || d.documentName.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q)) && (!role || d.roles.includes(role)));
  });
  /** The library, ten at a time (back to page 1 on a new search or role). */
  protected readonly library = new PagedView(this.shown, 10);
  protected readonly kind = signal<'file' | 'video'>('file');
  protected readonly picked = signal<Set<string>>(new Set());
  protected readonly fileName = signal('');
  protected readonly editing = signal<DocumentEdit | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected documentName = '';
  protected description = '';
  protected videoUrl = '';
  private file: File | null = null;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.documents());
      this.documents.set(r.documents);
      this.roles.set(r.roles);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected roleLabel(key: string): string {
    return this.roles().find((r) => r.key === key)?.label ?? key;
  }

  protected focusUpload(): void {
    this.nameInput()?.nativeElement.focus();
  }

  protected toggleRole(key: string): void {
    const next = new Set(this.picked());
    if (!next.delete(key)) next.add(key);
    this.picked.set(next);
  }

  protected pickAll(all: boolean): void {
    this.picked.set(new Set(all ? this.roles().map((r) => r.key) : []));
  }

  protected toggleEditRole(e: DocumentEdit, key: string): void {
    if (!e.roles.delete(key)) e.roles.add(key);
  }

  protected pick(event: Event): void {
    this.error.set('');
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    const ext = file ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (file && (!DOCUMENT_EXTENSIONS.includes(ext) || file.size > DOCUMENT_MAX_BYTES)) {
      this.error.set('Please upload a valid document (up to 5 MB).');
      this.clearFile();
      return;
    }
    this.file = file;
    this.fileName.set(file?.name ?? '');
  }

  private clearFile(): void {
    this.file = null;
    this.fileName.set('');
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  /** The role keys in the page's order. */
  private ordered(keys: Set<string>): string[] {
    return this.roles().map((r) => r.key).filter((k) => keys.has(k));
  }

  protected async save(): Promise<void> {
    this.error.set('');
    this.success.set('');
    const video = this.kind() === 'video';
    const missing = !this.documentName.trim() ? 'Please enter the document name.'
      : video && !this.videoUrl.trim() ? 'Please enter the video link.'
      : !video && !this.file ? 'Please select a file to upload.'
      : this.picked().size === 0 ? 'Please tick at least one role that may open the document.' : '';
    if (missing) {
      this.error.set(missing);
      return;
    }
    await this.run(async () => {
      const r = await firstValueFrom(this.api.addDocument({
        documentName: this.documentName.trim(), description: this.description.trim(), roles: this.ordered(this.picked()),
        file: video ? null : this.file, videoUrl: video ? this.videoUrl.trim() : null,
      }));
      this.documentName = '';
      this.description = '';
      this.videoUrl = '';
      this.picked.set(new Set());
      this.clearFile();
      return r.message;
    });
  }

  protected edit(d: DocumentRow): void {
    this.error.set('');
    this.success.set('');
    this.editing.set({ id: d.id, documentName: d.documentName, description: d.description ?? '', videoUrl: d.videoUrl, roles: new Set(d.roles) });
  }

  protected async saveEdit(e: DocumentEdit): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(this.api.updateDocument(e.id, {
        documentName: e.documentName.trim(), description: e.description.trim(), videoUrl: e.videoUrl?.trim() ?? null, roles: this.ordered(e.roles),
      }));
      this.editing.set(null);
      return r.message;
    });
  }

  protected async remove(d: DocumentRow): Promise<void> {
    if (!window.confirm(`Remove "${d.documentName}"? No one will see it any more.`)) return;
    await this.run(async () => (await firstValueFrom(this.api.deleteDocument(d.id))).message);
  }

  private async run(action: () => Promise<string>): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const message = await action();
      await this.load();
      this.success.set(message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
