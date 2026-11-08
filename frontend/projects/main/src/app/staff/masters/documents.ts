import { DatePipe } from '@angular/common';
import { Component, ElementRef, WritableSignal, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DocumentRole, DocumentRow, MastersApi } from './masters.api';
import { PagedView, PagerComponent } from '../pager';
import { AdminPortalService, PORTAL_API_BASE } from '../admin-portal';

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
  fileName: string | null;
  roles: Set<string>;
}

/** Which documents the library shows (the buttons beside the search box). */
type DocumentKindFilter = 'all' | 'file' | 'video';

/** The icon of a row: its colour and the short type name in it. */
interface DocumentIcon {
  tone: 'pdf' | 'doc' | 'sheet' | 'slides' | 'image' | 'video' | 'other';
  text: string;
}

/**
 * Admin → Masters → Documents/Videos (V4, as the LEAN portal's page; port of Views/MyDocuments/Index.cshtml): a document
 * is a file or a video link, with a description, given to the account types that may open it (the MSMEs on My
 * Documents and in the apps, staff on their Documents page). Upload and save are one step; the API names the file.
 * Documents from before have no roles set: they go to the MSMEs only, as before. V4 layout: the counts (documents,
 * files, videos, roles given documents), a search with a file / video filter and a chip per role with its count, each
 * document with a file-type icon, its description and its roles as chips; add and edit in a wide pop-up with the
 * details beside the roles, shown as toggle chips.
 * <p>One Admin (V4, main portal): the Consultancy portal's documents are managed here too. A document is matched by its
 * name and kind (file or video); its "Consultancy" tick copies it there (the file is downloaded here and uploaded there,
 * with the roles the Consultancy portal has) or, unticked, removes it there. Adding can publish on both; editing updates
 * both. Documents only the Consultancy portal has are listed below the library. 2026-11-08: the Surveillance portal the
 * same way (its "Surveillance" tick), for its staff's Documents page.</p>
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
      <div class="page-actions">
        <button type="button" class="btn btn-primary" (click)="openAdd()">+ Add document</button>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="doc-stats">
      <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">Documents and videos</span></div>
      <div class="stat"><span class="stat-value">{{ stats().files }}</span><span class="stat-label">Files to download</span></div>
      <div class="stat"><span class="stat-value">{{ stats().videos }}</span><span class="stat-label">Video links</span></div>
      <div class="stat"><span class="stat-value">{{ stats().rolesUsed }}<small>/{{ roles().length }}</small></span><span class="stat-label">Roles given documents</span></div>
    </div>

    <section class="zed-card" aria-labelledby="doc-library-h">
      <div class="doc-head">
        <h5 class="doc-h m-0" id="doc-library-h">Document Library <span class="zed-chip">{{ shown().length }} document{{ shown().length === 1 ? '' : 's' }}</span></h5>
      </div>
      <div class="doc-toolbar">
        <input class="form-control doc-search" type="search" placeholder="Search name or description" aria-label="Search documents" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        <div class="seg" role="group" aria-label="Type">
          @for (k of kinds; track k.key) {
            <button type="button" [class.active]="kindFilter() === k.key" [attr.aria-pressed]="kindFilter() === k.key" (click)="kindFilter.set(k.key)">{{ k.label }}</button>
          }
        </div>
      </div>
      <div class="role-filter" role="group" aria-label="Role">
        <span class="role-filter-label">Who can open:</span>
        <button type="button" class="role-pill" [class.active]="!roleFilter()" [attr.aria-pressed]="!roleFilter()" (click)="roleFilter.set('')">All roles <span class="pill-count">{{ documents().length }}</span></button>
        @for (r of roles(); track r.key) {
          <button type="button" class="role-pill" [class.active]="roleFilter() === r.key" [class.none]="!roleCount(r.key)" [attr.aria-pressed]="roleFilter() === r.key"
                  [attr.data-role]="r.key" (click)="roleFilter.set(r.key)">{{ r.label }} <span class="pill-count">{{ roleCount(r.key) }}</span></button>
        }
      </div>

      @for (d of library.page(); track d.id) {
        @let icon = iconOf(d);
        <div class="doc-item">
          <span class="doc-icon" [class]="'tone-' + icon.tone" aria-hidden="true">
            @if (icon.tone === 'video') {
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
            } @else {
              {{ icon.text }}
            }
          </span>
          <div class="doc-item-main">
            <div class="doc-title">
              <strong>{{ d.documentName }}</strong>
              <span class="kind-badge" [class.video]="!!d.videoUrl">{{ d.videoUrl ? 'Video' : 'File' }}</span>
            </div>
            @if (d.description) { <p class="doc-desc">{{ d.description }}</p> }
            @if (cons() || surv()) {
              <div class="shown-on" role="group" [attr.aria-label]="'Shown on, ' + d.documentName">
                <span class="shown-label">Shown on</span>
                <span class="portal-tick on" title="This list is the ZED Certification portal's">ZED Certification ✓</span>
                @if (cons()) {
                  <label class="portal-tick" [class.on]="!!twinOf(d)">
                    <input type="checkbox" [checked]="!!twinOf(d)" [disabled]="saving()" (change)="toggleConsultancy(d)" [attr.aria-label]="'Show ' + d.documentName + ' on the Consultancy portal'" />
                    Consultancy
                  </label>
                }
                @if (surv()) {
                  <label class="portal-tick" [class.on]="!!twinOf(d, 'surveillance')" data-surveillance-tick>
                    <input type="checkbox" [checked]="!!twinOf(d, 'surveillance')" [disabled]="saving()" (change)="toggleOther(d, 'surveillance')" [attr.aria-label]="'Show ' + d.documentName + ' on the Surveillance portal'" />
                    Surveillance
                  </label>
                }
              </div>
            }
            <div class="doc-chips">
              @for (k of d.roles; track k) { <span class="doc-chip">{{ roleLabel(k) }}</span> }
              @if (!d.roles.length) { <span class="doc-chip legacy">MSMEs only (no roles set)</span> }
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
        <div class="no-data">{{ documents().length ? 'Nothing matches the search and filters.' : 'No documents published yet. Use + Add document to upload the first one.' }}</div>
      }
      @if (shown().length) {
        <zed-pager [pager]="library" />
      }
    </section>

    @if (consError()) {
      <div class="alert alert-warning mt-3" role="status">Consultancy portal: {{ consError() }} Its documents are not shown here.</div>
    }
    @if (consOnly().length) {
      <section class="zed-card mt-3" aria-labelledby="doc-cons-h">
        <h5 class="doc-h" id="doc-cons-h">Only on the Consultancy portal <span class="zed-chip">{{ consOnly().length }}</span></h5>
        @for (d of consOnly(); track d.id) {
          <div class="doc-item">
            <div class="doc-item-main">
              <div class="doc-title"><strong>{{ d.documentName }}</strong> <span class="kind-badge" [class.video]="!!d.videoUrl">{{ d.videoUrl ? 'Video' : 'File' }}</span></div>
              @if (d.description) { <p class="doc-desc">{{ d.description }}</p> }
              <div class="doc-chips">@for (k of d.roles; track k) { <span class="doc-chip">{{ consRoleLabel(k) }}</span> }</div>
            </div>
            <div class="row-actions">
              @if (d.videoUrl) {
                <a class="btn btn-sm btn-outline-primary" [href]="d.videoUrl" target="_blank" rel="noopener noreferrer">Watch</a>
              } @else if (d.downloadUrl) {
                <a class="btn btn-sm btn-outline-primary" [href]="consBase + d.downloadUrl" target="_blank" rel="noopener">Download</a>
              }
              <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="saving()" (click)="copyToMain(d)">Show on ZED Certification too</button>
              <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="saving()" (click)="removeFromConsultancy(d)">Remove</button>
            </div>
          </div>
        }
      </section>
    }

    @if (survError()) {
      <div class="alert alert-warning mt-3" role="status">Surveillance portal: {{ survError() }} Its documents are not shown here.</div>
    }
    @if (survOnly().length) {
      <section class="zed-card mt-3" aria-labelledby="doc-surv-h" data-surveillance-only>
        <h5 class="doc-h" id="doc-surv-h">Only on the Surveillance portal <span class="zed-chip">{{ survOnly().length }}</span></h5>
        @for (d of survOnly(); track d.id) {
          <div class="doc-item">
            <div class="doc-item-main">
              <div class="doc-title"><strong>{{ d.documentName }}</strong> <span class="kind-badge" [class.video]="!!d.videoUrl">{{ d.videoUrl ? 'Video' : 'File' }}</span></div>
              @if (d.description) { <p class="doc-desc">{{ d.description }}</p> }
              <div class="doc-chips">@for (k of d.roles; track k) { <span class="doc-chip">{{ otherRoleLabel(k, 'surveillance') }}</span> }</div>
            </div>
            <div class="row-actions">
              @if (d.videoUrl) {
                <a class="btn btn-sm btn-outline-primary" [href]="d.videoUrl" target="_blank" rel="noopener noreferrer">Watch</a>
              } @else if (d.downloadUrl) {
                <a class="btn btn-sm btn-outline-primary" [href]="survBase + d.downloadUrl" target="_blank" rel="noopener">Download</a>
              }
              <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="saving()" (click)="copyToMain(d, 'surveillance')">Show on ZED Certification too</button>
              <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="saving()" (click)="removeFrom(d, 'surveillance')">Remove</button>
            </div>
          </div>
        }
      </section>
    }

    @if (adding()) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="doc-add-title">
        <div class="modal-dialog modal-popup modal-xl modal-dialog-centered doc-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="doc-add-title">Add a document or video</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="adding.set(false)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <div class="doc-form">
                <section class="doc-pane" aria-labelledby="doc-upload-h">
                  <h5 class="doc-sec" id="doc-upload-h"><span class="sec-no">1</span> The document</h5>
                  <span class="field-label">What are you adding?</span>
                  <div class="kind-cards" role="group" aria-label="What are you adding?">
                    <button type="button" class="kind-card" [class.active]="kind() === 'file'" [attr.aria-pressed]="kind() === 'file'" (click)="kind.set('file')">
                      <strong>Upload a file</strong><small>PDF, Word, Excel, PowerPoint, CSV, text or an image</small>
                    </button>
                    <button type="button" class="kind-card" [class.active]="kind() === 'video'" [attr.aria-pressed]="kind() === 'video'" (click)="kind.set('video')">
                      <strong>Video link</strong><small>A YouTube or hosted video, played from where it is</small>
                    </button>
                  </div>
                  <label class="field-label" for="documentName">Document name<span class="req">*</span></label>
                  <input #nameInput id="documentName" class="form-control" maxlength="200" placeholder="Enter document name" [(ngModel)]="documentName" />
                  <label class="field-label doc-count-label" for="documentDescription">Description <span class="muted">{{ description.length }} / {{ max }}</span></label>
                  <textarea id="documentDescription" class="form-control" rows="3" [attr.maxlength]="max" placeholder="Brief description of the document..." [(ngModel)]="description"></textarea>
                  @if (kind() === 'file') {
                    <span class="field-label">File<span class="req">*</span></span>
                    <label class="doc-drop" [class.picked]="fileName()" for="fileControl">
                      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
                      <span class="doc-drop-title">{{ fileName() || 'Choose a file, or drop it here' }}</span>
                      <span class="muted">{{ fileName() ? fileSize() + ' · click to choose another' : 'Supported: ' + accept + ' (max 5 MB)' }}</span>
                      <input #fileInput type="file" id="fileControl" [accept]="accept" (change)="pick($event)" />
                    </label>
                  } @else {
                    <label class="field-label" for="videoUrl">Video link<span class="req">*</span></label>
                    <input id="videoUrl" class="form-control" placeholder="Paste the YouTube or hosted video address (https://)" [(ngModel)]="videoUrl" />
                    <small class="muted d-block mt-1">The video is played from where it is hosted. Nothing is uploaded or stored here.</small>
                  }
                </section>
                <section class="doc-pane doc-roles" aria-labelledby="doc-roles-h">
                  <h5 class="doc-sec" id="doc-roles-h"><span class="sec-no">2</span> Who can open it</h5>
                  <p class="muted">Turn on a role to let every user of that account type open the document.</p>
                  <div class="doc-roles-head">
                    <span class="muted">{{ picked().size }} of {{ roles().length }} selected</span>
                    <label class="doc-role doc-all" [class.on]="allPicked()">
                      <input type="checkbox" [checked]="allPicked()" (change)="pickAll($any($event.target).checked)" /> Select all
                    </label>
                  </div>
                  <div class="doc-role-grid">
                    @for (r of roles(); track r.key) {
                      <label class="doc-role" [class.on]="picked().has(r.key)"><input type="checkbox" [checked]="picked().has(r.key)" (change)="toggleRole(r.key)" /> {{ r.label }}</label>
                    }
                  </div>
                  <small class="muted">Changes apply the next time each user opens the documents.</small>
                </section>
              </div>
              @if (formError()) {
                <div class="alert alert-danger mt-3 mb-0" role="alert">{{ formError() }}</div>
              }
            </div>
            <div class="modal-footer">
              <span class="me-auto d-flex flex-wrap gap-3">
                @if (cons()) {
                  <label class="also-cons"><input type="checkbox" class="form-check-input" [(ngModel)]="alsoConsultancy" /> Also show on the Consultancy portal</label>
                }
                @if (surv()) {
                  <label class="also-cons"><input type="checkbox" class="form-check-input" [(ngModel)]="alsoSurveillance" data-also-surveillance /> Also show on the Surveillance portal</label>
                }
              </span>
              <button type="button" class="btn btn-default" (click)="adding.set(false)">Cancel</button>
              <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save()">Upload</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="doc-edit-title">
        <div class="modal-dialog modal-popup modal-xl modal-dialog-centered doc-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="doc-edit-title">Edit document</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <div class="doc-form">
                <section class="doc-pane" aria-label="The document">
                  <h5 class="doc-sec"><span class="sec-no">1</span> The document</h5>
                  <label class="field-label" for="editName">Document name<span class="req">*</span></label>
                  <input id="editName" class="form-control" maxlength="200" [(ngModel)]="e.documentName" />
                  <label class="field-label doc-count-label" for="editDescription">Description <span class="muted">{{ e.description.length }} / {{ max }}</span></label>
                  <textarea id="editDescription" class="form-control" rows="3" [attr.maxlength]="max" [(ngModel)]="e.description"></textarea>
                  @if (e.videoUrl !== null) {
                    <label class="field-label" for="editVideo">Video link<span class="req">*</span></label>
                    <input id="editVideo" class="form-control" [(ngModel)]="e.videoUrl" />
                  } @else {
                    <span class="field-label">File</span>
                    <div class="file-note">{{ e.fileName || 'Uploaded file' }} <small class="muted d-block">The file stays as it is. To change it, add the new file and delete this one.</small></div>
                  }
                </section>
                <section class="doc-pane doc-roles" aria-label="Who can open it">
                  <h5 class="doc-sec"><span class="sec-no">2</span> Who can open it</h5>
                  <div class="doc-roles-head">
                    <span class="muted">{{ e.roles.size }} of {{ roles().length }} selected</span>
                  </div>
                  <div class="doc-role-grid">
                    @for (r of roles(); track r.key) {
                      <label class="doc-role" [class.on]="e.roles.has(r.key)"><input type="checkbox" [checked]="e.roles.has(r.key)" (change)="toggleEditRole(e, r.key)" /> {{ r.label }}</label>
                    }
                  </div>
                </section>
              </div>
              @if (editError()) {
                <div class="alert alert-danger mt-3 mb-0" role="alert">{{ editError() }}</div>
              }
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

    /* The counts. */
    .doc-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-value small { font-size: 15px; color: #8a9899; font-weight: 600; }
    .stat-label { font-size: 13px; color: #5f6f70; }

    /* Search, file / video and the role chips. */
    .doc-head { margin-bottom: 12px; }
    .doc-h { font-weight: 700; color: #23474a; display: flex; align-items: center; gap: 8px; }
    .doc-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .doc-search { flex: 1 1 260px; max-width: 420px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 7px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #eef6f6; }
    .seg button.active { background: #45a5ad; color: #fff; }
    .role-filter { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-bottom: 12px; margin-bottom: 4px; border-bottom: 1px solid #eef3f3; }
    .role-filter-label { font-size: 13px; font-weight: 600; color: #5f6f70; margin-right: 4px; }
    .role-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 16px; border: 1px solid #cbd9da; background: #fff;
      color: #2f7c83; font-size: 13px; font-weight: 600; cursor: pointer; }
    .role-pill:hover { background: #eef6f6; border-color: #45a5ad; }
    .role-pill.none:not(.active) { color: #8a9899; }
    .role-pill.active { background: #45a5ad; border-color: #45a5ad; color: #fff; }
    .pill-count { font-size: 11px; border-radius: 10px; padding: 0 7px; background: #eef6f6; color: #23474a; }
    .role-pill.active .pill-count { background: rgba(255,255,255,.25); color: #fff; }

    /* A row per document. */
    .doc-item { display: flex; gap: 14px; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid #eef3f3; }
    .doc-icon { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 10px; display: inline-grid; place-items: center; font-size: 11px; font-weight: 800; letter-spacing: .03em; }
    .tone-pdf { background: #fdeef0; color: #a8303a; }
    .tone-doc { background: #f1f0fb; color: #3f3a7a; }
    .tone-sheet { background: #e7f5ec; color: #1e7a3c; }
    .tone-slides { background: #fff4d6; color: #8a6100; }
    .tone-image, .tone-other { background: #eef6f6; color: #2f7c83; }
    .tone-video { background: #23474a; color: #fff; }
    .doc-item-main { flex: 1 1 auto; min-width: 0; }
    .doc-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .doc-title strong { color: #232527; font-size: 15px; overflow-wrap: anywhere; }
    .kind-badge { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 10px; background: #eef6f6; color: #2f7c83; }
    .kind-badge.video { background: #f1f0fb; color: #3f3a7a; }
    .doc-desc { color: #5f6f70; font-size: 13.5px; margin: 3px 0 6px; overflow-wrap: anywhere; }
    .doc-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px; }
    .doc-chip { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: #eef6f6; color: #2f7c83; }
    .doc-chip.legacy { background: #fff4d6; color: #8a6100; }
    .doc-added { font-size: 12px; color: #5f6f70; margin-left: 4px; }
    .shown-on { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0 2px; }
    .shown-label { font-size: 12px; font-weight: 700; color: #5f6f70; }
    .portal-tick { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; border-radius: 12px; padding: 1px 10px;
      border: 1px solid #dfe9ea; color: #5f6f70; background: #fff; margin: 0; cursor: pointer; }
    .portal-tick.on { background: #e6f6ec; border-color: #bfe3cb; color: #1e7a3c; }
    .portal-tick input { margin: 0; }
    .also-cons { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: #23474a; }
    .also-cons .form-check-input { margin: 0; float: none; }
    .doc-item .row-actions { flex: none; flex-wrap: nowrap; }

    /* The add / edit pop-up: details beside the roles. */
    .modal > .modal-dialog.modal-xl.doc-dialog { max-width: 1040px; width: calc(100% - 32px); }
    .modal .doc-dialog textarea.form-control { min-height: 0; height: auto; }
    .modal .modal-popup.doc-dialog label { font-weight: 400; color: #232527; }
    .modal .modal-popup.doc-dialog .field-label { display: block; margin: 12px 0 4px; font-size: 14px; font-weight: 600; color: #3b4b4c; }
    .doc-form { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; }
    .doc-pane { min-width: 0; }
    .doc-roles { border: 1px solid #dfe9ea; border-radius: 12px; background: #fbfdfd; padding: 14px 16px; }
    .doc-sec { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #23474a; margin: 0 0 4px; }
    .sec-no { width: 22px; height: 22px; border-radius: 11px; background: #45a5ad; color: #fff; font-size: 12px; display: inline-grid; place-items: center; }
    .doc-count-label { display: flex !important; justify-content: space-between; }
    .kind-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .kind-card { display: flex; flex-direction: column; gap: 2px; text-align: left; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; background: #fff; cursor: pointer; }
    .kind-card strong { color: #23474a; font-size: 14px; }
    .kind-card small { color: #5f6f70; font-size: 12px; }
    .kind-card:hover { border-color: #45a5ad; }
    .kind-card.active { border-color: #45a5ad; background: #f4fafa; box-shadow: inset 0 0 0 1px #45a5ad; }
    .doc-drop { position: relative; display: flex !important; flex-direction: column; align-items: center; gap: 4px; padding: 22px 16px; margin: 0;
      border: 2px dashed #b9d3d5; border-radius: 12px; background: #f8fbfb; color: #2f7c83; cursor: pointer; text-align: center; overflow-wrap: anywhere; }
    .doc-drop:hover, .doc-drop:focus-within { border-color: #45a5ad; background: #f1f8f8; }
    .doc-drop.picked { border-style: solid; border-color: #45a5ad; }
    .doc-drop-title { font-weight: 600; color: #23474a; }
    .doc-drop .muted { font-size: 12.5px; }
    .doc-drop input[type=file] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    .file-note { border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; background: #f8fbfb; color: #23474a; font-weight: 600; overflow-wrap: anywhere; }
    .file-note small { font-weight: 400; }
    .doc-roles-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .doc-role-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .modal .modal-popup.doc-dialog label.doc-role { position: relative; display: inline-flex; align-items: center; gap: 6px; margin: 0; padding: 6px 12px; border: 1px solid #cbd9da;
      border-radius: 18px; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; cursor: pointer; user-select: none; }
    .modal .modal-popup.doc-dialog label.doc-role::before { content: '+'; font-weight: 700; width: 12px; text-align: center; }
    .modal .modal-popup.doc-dialog label.doc-role.on { background: #45a5ad; border-color: #45a5ad; color: #fff; }
    .modal .modal-popup.doc-dialog label.doc-role.on::before { content: '✓'; }
    .modal .modal-popup.doc-dialog label.doc-role:has(input:focus-visible) { outline: 2px solid #2f7c83; outline-offset: 2px; }
    .doc-role input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
    .modal .modal-popup.doc-dialog label.doc-all { padding: 4px 12px; }

    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .doc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .doc-search { max-width: none; flex-basis: 100%; }
      .doc-form, .kind-cards { grid-template-columns: minmax(0, 1fr); }
      .doc-item { flex-wrap: wrap; }
      .doc-item-main { flex-basis: calc(100% - 58px); }
      .doc-item .row-actions { flex-basis: 100%; flex-wrap: wrap; padding-left: 58px; }
    }
  `,
})
export class DocumentsAdminPage {
  private readonly api = inject(MastersApi);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly accept = DOCUMENT_EXTENSIONS.join(',');
  protected readonly max = DESCRIPTION_MAX;
  protected readonly kinds: readonly { key: DocumentKindFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'file', label: 'Files' },
    { key: 'video', label: 'Videos' },
  ];
  protected readonly documents = signal<DocumentRow[]>([]);
  protected readonly roles = signal<DocumentRole[]>([]);
  protected readonly search = signal('');
  protected readonly roleFilter = signal('');
  protected readonly kindFilter = signal<DocumentKindFilter>('all');
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const role = this.roleFilter();
    const kind = this.kindFilter();
    return this.documents().filter((d) =>
      (!q || d.documentName.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q)) && (!role || d.roles.includes(role))
      && (kind === 'all' || (kind === 'video') === !!d.videoUrl));
  });
  protected readonly stats = computed(() => {
    const docs = this.documents();
    const videos = docs.filter((d) => d.videoUrl).length;
    return {
      total: docs.length,
      videos,
      files: docs.length - videos,
      rolesUsed: this.roles().filter((r) => docs.some((d) => d.roles.includes(r.key))).length,
    };
  });
  /** The library, ten at a time (back to page 1 on a new search, type or role). */
  protected readonly library = new PagedView(this.shown, 10);
  protected readonly kind = signal<'file' | 'video'>('file');
  protected readonly picked = signal<Set<string>>(new Set());
  protected readonly allPicked = computed(() => this.picked().size === this.roles().length && this.roles().length > 0);
  protected readonly fileName = signal('');
  protected readonly fileSize = signal('');
  protected readonly adding = signal(false);
  protected readonly editing = signal<DocumentEdit | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  /** Messages of the add and edit pop-ups, shown inside them. */
  protected readonly formError = signal('');
  protected readonly editError = signal('');
  protected readonly success = signal('');
  protected documentName = '';
  protected description = '';
  protected videoUrl = '';
  private file: File | null = null;

  /** One Admin (main portal): the Consultancy portal's documents and roles; null when not managed here or not reached. */
  protected readonly cons = signal<{ documents: DocumentRow[]; roles: DocumentRole[] } | null>(null);
  protected readonly consError = signal('');
  protected readonly consBase = PORTAL_API_BASE.consultancy;
  /** The add pop-up's "Also show on the Consultancy portal". */
  protected alsoConsultancy = false;
  /** 2026-11-08: the Surveillance portal's documents (its staff's Documents page), managed the same way. */
  protected readonly surv = signal<{ documents: DocumentRow[]; roles: DocumentRole[] } | null>(null);
  protected readonly survError = signal('');
  protected readonly survBase = PORTAL_API_BASE.surveillance;
  protected alsoSurveillance = false;
  protected readonly survOnly = computed(() => (this.surv()?.documents ?? []).filter((c) => !this.documents().some((d) => same(d, c))));
  private readonly portals = inject(AdminPortalService);
  protected readonly consOnly = computed(() => (this.cons()?.documents ?? []).filter((c) => !this.documents().some((d) => same(d, c))));

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
    if (!this.portals.enabled) return;
    await Promise.all((['consultancy', 'surveillance'] as const).map(async (p) => {
      try {
        this.store(p).set(await firstValueFrom(this.api.documents(p)));
        this.storeError(p).set('');
      } catch (err) {
        this.store(p).set(null);
        this.storeError(p).set(apiErrorMessage(err));
      }
    }));
  }

  private store(p: OtherPortal) {
    return p === 'consultancy' ? this.cons : this.surv;
  }

  private storeError(p: OtherPortal) {
    return p === 'consultancy' ? this.consError : this.survError;
  }

  /** The other portal's copy of a main document (same name and kind). */
  protected twinOf(d: DocumentRow, p: OtherPortal = 'consultancy'): DocumentRow | undefined {
    return this.store(p)()?.documents.find((c) => same(d, c));
  }

  protected consRoleLabel(key: string): string {
    return this.otherRoleLabel(key, 'consultancy');
  }

  protected otherRoleLabel(key: string, p: OtherPortal): string {
    return this.store(p)()?.roles.find((r) => r.key === key)?.label ?? key;
  }

  /** The roles of a document that the target portal has (in its order). */
  private rolesFor(keys: string[], target: DocumentRole[], portalName: string): string[] {
    const mapped = target.map((r) => r.key).filter((k) => keys.includes(k));
    if (!mapped.length) throw new Error(`None of its roles exist on the ${portalName} portal. Add it there with its own roles.`);
    return mapped;
  }

  /** Copies a document to the other portal: a video as its link, a file downloaded here and uploaded there. */
  private async copy(d: DocumentRow, from: 'main' | OtherPortal, to: 'main' | OtherPortal, roles: string[]): Promise<void> {
    let file: File | null = null;
    if (!d.videoUrl) {
      if (!d.downloadUrl) throw new Error('Its file is missing.');
      const blob = await firstValueFrom(this.api.documentFile(d.downloadUrl, from === 'main' ? undefined : from));
      file = new File([blob], d.fileName ?? d.documentName, { type: blob.type });
    }
    await firstValueFrom(this.api.addDocument({
      documentName: d.documentName, description: d.description ?? '', roles, file, videoUrl: d.videoUrl,
    }, to === 'main' ? undefined : to));
  }

  protected toggleConsultancy(d: DocumentRow): Promise<void> {
    return this.toggleOther(d, 'consultancy');
  }

  /** The "Consultancy" / "Surveillance" tick: copies the document there, or removes it there. */
  protected async toggleOther(d: DocumentRow, p: OtherPortal): Promise<void> {
    const name = PORTAL_NAMES[p];
    const twin = this.twinOf(d, p);
    if (twin) {
      if (!window.confirm(`Remove "${d.documentName}" from the ${name} portal? It stays on ZED Certification.`)) {
        this.store(p).set({ ...this.store(p)()! });
        return;
      }
      await this.run(async () => {
        await firstValueFrom(this.api.deleteDocument(twin.id, p));
        return `"${d.documentName}" removed from the ${name} portal.`;
      });
      return;
    }
    await this.run(async () => {
      await this.copy(d, 'main', p, this.rolesFor(d.roles, this.store(p)()!.roles, name));
      return `"${d.documentName}" is now shown on the ${name} portal too.`;
    });
  }

  protected async copyToMain(d: DocumentRow, from: OtherPortal = 'consultancy'): Promise<void> {
    await this.run(async () => {
      await this.copy(d, from, 'main', this.rolesFor(d.roles, this.roles(), 'ZED Certification'));
      return `"${d.documentName}" is now shown on the ZED Certification portal too.`;
    });
  }

  protected removeFromConsultancy(d: DocumentRow): Promise<void> {
    return this.removeFrom(d, 'consultancy');
  }

  protected async removeFrom(d: DocumentRow, p: OtherPortal): Promise<void> {
    if (!window.confirm(`Remove "${d.documentName}" from the ${PORTAL_NAMES[p]} portal? No one there will see it any more.`)) return;
    await this.run(async () => (await firstValueFrom(this.api.deleteDocument(d.id, p))).message);
  }

  protected roleLabel(key: string): string {
    return this.roles().find((r) => r.key === key)?.label ?? key;
  }

  protected roleCount(key: string): number {
    return this.documents().filter((d) => d.roles.includes(key)).length;
  }

  /** The row's icon, by the stored file's extension (the API keeps it when it names the file). */
  protected iconOf(d: DocumentRow): DocumentIcon {
    if (d.videoUrl) return { tone: 'video', text: 'Video' };
    const name = d.fileName ?? '';
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    switch (ext) {
      case 'pdf': return { tone: 'pdf', text: 'PDF' };
      case 'docx': case 'txt': return { tone: 'doc', text: ext.toUpperCase() };
      case 'xlsx': case 'csv': return { tone: 'sheet', text: ext.toUpperCase() };
      case 'pptx': return { tone: 'slides', text: 'PPTX' };
      case 'jpg': case 'jpeg': case 'png': return { tone: 'image', text: 'IMG' };
      default: return { tone: 'other', text: 'FILE' };
    }
  }

  protected openAdd(): void {
    this.documentName = this.description = this.videoUrl = '';
    this.kind.set('file');
    this.picked.set(new Set());
    this.clearFile();
    this.formError.set('');
    this.success.set('');
    this.adding.set(true);
    setTimeout(() => this.nameInput()?.nativeElement.focus());
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
    this.formError.set('');
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    const ext = file ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (file && (!DOCUMENT_EXTENSIONS.includes(ext) || file.size > DOCUMENT_MAX_BYTES)) {
      this.formError.set('Please upload a valid document (up to 5 MB).');
      this.clearFile();
      return;
    }
    this.file = file;
    this.fileName.set(file?.name ?? '');
    this.fileSize.set(file ? (file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`) : '');
  }

  private clearFile(): void {
    this.file = null;
    this.fileName.set('');
    this.fileSize.set('');
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  /** The role keys in the page's order. */
  private ordered(keys: Set<string>): string[] {
    return this.roles().map((r) => r.key).filter((k) => keys.has(k));
  }

  protected async save(): Promise<void> {
    this.formError.set('');
    this.success.set('');
    const video = this.kind() === 'video';
    const missing = !this.documentName.trim() ? 'Please enter the document name.'
      : video && !this.videoUrl.trim() ? 'Please enter the video link.'
      : !video && !this.file ? 'Please select a file to upload.'
      : this.picked().size === 0 ? 'Please tick at least one role that may open the document.' : '';
    if (missing) {
      this.formError.set(missing);
      return;
    }
    await this.run(async () => {
      const doc = {
        documentName: this.documentName.trim(), description: this.description.trim(), roles: this.ordered(this.picked()),
        file: video ? null : this.file, videoUrl: video ? this.videoUrl.trim() : null,
      };
      const r = await firstValueFrom(this.api.addDocument(doc));
      const also: OtherPortal[] = [
        ...(this.alsoConsultancy && this.cons() ? (['consultancy'] as const) : []),
        ...(this.alsoSurveillance && this.surv() ? (['surveillance'] as const) : []),
      ];
      for (const p of also) {
        const name = PORTAL_NAMES[p];
        try {
          await firstValueFrom(this.api.addDocument({ ...doc, roles: this.rolesFor(doc.roles, this.store(p)()!.roles, name) }, p));
          r.message += ` Also shown on the ${name} portal.`;
        } catch (err) {
          r.message += ` Not added on the ${name} portal: ${err instanceof Error && !('status' in err) ? err.message : apiErrorMessage(err)}`;
        }
      }
      this.alsoConsultancy = false;
      this.alsoSurveillance = false;
      this.documentName = '';
      this.description = '';
      this.videoUrl = '';
      this.picked.set(new Set());
      this.clearFile();
      this.adding.set(false);
      return r.message;
    }, this.formError);
  }

  protected edit(d: DocumentRow): void {
    this.error.set('');
    this.editError.set('');
    this.success.set('');
    this.editing.set({ id: d.id, documentName: d.documentName, description: d.description ?? '', videoUrl: d.videoUrl, fileName: d.fileName, roles: new Set(d.roles) });
  }

  protected async saveEdit(e: DocumentEdit): Promise<void> {
    const before = this.documents().find((d) => d.id === e.id);
    const twins = (['consultancy', 'surveillance'] as const)
      .map((p) => ({ p, twin: before ? this.twinOf(before, p) : undefined }))
      .filter((t): t is { p: OtherPortal; twin: DocumentRow } => !!t.twin);
    await this.run(async () => {
      const update = { documentName: e.documentName.trim(), description: e.description.trim(), videoUrl: e.videoUrl?.trim() ?? null, roles: this.ordered(e.roles) };
      const r = await firstValueFrom(this.api.updateDocument(e.id, update));
      this.editing.set(null);
      let message = r.message;
      for (const { p, twin } of twins) {
        const name = PORTAL_NAMES[p];
        try {
          await firstValueFrom(this.api.updateDocument(twin.id, { ...update, roles: this.rolesFor(update.roles, this.store(p)()!.roles, name) }, p));
          message += ` Updated on the ${name} portal too.`;
        } catch (err) {
          message += ` Not updated on the ${name} portal: ${err instanceof Error && !('status' in err) ? err.message : apiErrorMessage(err)}`;
        }
      }
      return message;
    }, this.editError);
  }

  protected async remove(d: DocumentRow): Promise<void> {
    if (!window.confirm(`Remove "${d.documentName}"? No one will see it any more.`)) return;
    await this.run(async () => (await firstValueFrom(this.api.deleteDocument(d.id))).message);
  }

  /** Runs a save; its error goes to <paramref name="failed"/> (the page, or the open pop-up). */
  private async run(action: () => Promise<string>, failed: WritableSignal<string> = this.error): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    failed.set('');
    this.success.set('');
    try {
      const message = await action();
      await this.load();
      this.success.set(message);
    } catch (err) {
      failed.set(err instanceof Error && !('status' in err) ? err.message : apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}

/** The portals whose documents the main Admin also manages here (Surveillance since 2026-11-08). */
type OtherPortal = 'consultancy' | 'surveillance';
const PORTAL_NAMES: Record<OtherPortal, string> = { consultancy: 'Consultancy', surveillance: 'Surveillance' };

/** The same document on two portals: same name (any case) and kind (file or video link). */
function same(a: DocumentRow, b: DocumentRow): boolean {
  return a.documentName.trim().toLowerCase() === b.documentName.trim().toLowerCase() && !!a.videoUrl === !!b.videoUrl;
}
