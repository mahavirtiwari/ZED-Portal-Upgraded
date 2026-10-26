import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DocumentRow, MastersApi } from './masters.api';
import { CollapseCard } from '../collapse-card';

/** Same list as the API (MasterUploads.DocumentTypes); the API checks type, content and size again. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.txt', '.jpg', '.jpeg', '.png'];
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Guideline documents shown to MSMEs on My Documents (Admin). Port of Views/MyDocuments/Index.cshtml.
 * Upload and save are one step now: the API stores the file under a name it chooses. V4: the form in a card with
 * labelled fields.
 */
@Component({
  selector: 'zed-staff-documents',
  imports: [FormsModule, CollapseCard],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">My Documents</h3>
        <p class="page-sub">Guideline documents the MSMEs can download from their My Documents page.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <zed-collapse-card title="Add Document" summary="Open to add a document to the list.">
      <form class="add-form" (ngSubmit)="save()" novalidate>
        <div class="form-grid">
          <label for="documentName">Document Name<span class="req">*</span></label>
          <div>
            <input id="documentName" name="documentName" class="form-control" maxlength="200" [(ngModel)]="documentName" />
            @if (submitted() && !documentName.trim()) { <span class="help-block">Document Name required.</span> }
          </div>
          <label for="fileControl">Document file<span class="req">*</span></label>
          <div>
            <input #fileInput type="file" id="fileControl" class="form-control" [accept]="accept" (change)="pick($event)" />
            <small class="text-danger">Valid Document size &lt; <strong>5 MB</strong> ({{ accept }})</small>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="saving()">Save</button>
        </div>
      </form>
    </zed-collapse-card>

    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th>Document Name</th>
            <th class="text-center" style="width: 140px">Document</th>
            <th class="text-center" style="width: 110px">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (d of documents(); track d.id) {
            <tr>
              <td><strong>{{ d.documentName }}</strong></td>
              <td class="text-center">
                @if (d.downloadUrl) {
                  <a [href]="d.downloadUrl" target="_blank" rel="noopener">Download</a>
                }
              </td>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  <button type="button" class="btn btn-outline-danger" [disabled]="saving()" (click)="remove(d)">Delete</button>
                </div>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="3" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (saving()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Saving…</span></div>
    }
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class DocumentsAdminPage {
  private readonly api = inject(MastersApi);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly accept = DOCUMENT_EXTENSIONS.join(',');
  protected readonly documents = signal<DocumentRow[]>([]);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected documentName = '';
  private file: File | null = null;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.documents.set(await firstValueFrom(this.api.documents()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected pick(event: Event): void {
    this.error.set('');
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    const ext = file ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (file && (!DOCUMENT_EXTENSIONS.includes(ext) || file.size > DOCUMENT_MAX_BYTES)) {
      this.error.set('Please upload valid document.');
      this.clearFile();
      return;
    }
    this.file = file;
  }

  private clearFile(): void {
    this.file = null;
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.error.set('');
    this.success.set('');
    if (!this.documentName.trim() || !this.file) {
      this.error.set(!this.file ? 'Please select a file to upload.' : 'Please enter valid data.');
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.addDocument(this.documentName.trim(), this.file))).message);
      this.documentName = '';
      this.submitted.set(false);
      this.clearFile();
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(d: DocumentRow): Promise<void> {
    if (!window.confirm(`Remove "${d.documentName}" from the documents shown to MSMEs?`)) return;
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.deleteDocument(d.id))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
