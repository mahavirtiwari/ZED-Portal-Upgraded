import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DocumentRow, MastersApi } from './masters.api';

/** Same list as the API (MasterUploads.DocumentTypes); the API checks type, content and size again. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.txt', '.jpg', '.jpeg', '.png'];
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Guideline documents shown to MSMEs on My Documents (Admin). Port of Views/MyDocuments/Index.cshtml.
 * Upload and save are one step now: the API stores the file under a name it chooses.
 */
@Component({
  selector: 'zed-staff-documents',
  imports: [FormsModule],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4">
        <div class="col-sm-12"><h3 class="registration-title">My Documents</h3></div>
        @if (error()) {
          <div class="col-sm-12"><div class="alert alert-danger" role="alert">{{ error() }}</div></div>
        }
        @if (success()) {
          <div class="col-sm-12"><div class="alert alert-success" role="status">{{ success() }}</div></div>
        }
        <div class="col-sm-12">
          <form class="jumbotron" (ngSubmit)="save()" novalidate>
            <div class="row">
              <div class="col-sm-12" style="margin-bottom: 9px">
                <div class="input-group">
                  <label class="input-group-text" for="documentName">Document Name<span style="color: red">*</span></label>
                  <input id="documentName" name="documentName" class="form-control" maxlength="200" style="max-width: 100%" [(ngModel)]="documentName" />
                </div>
                @if (submitted() && !documentName.trim()) { <span class="help-block">Document Name required.</span> }
              </div>
              <div class="col-sm-5">
                <label class="visually-hidden" for="fileControl">Document file</label>
                <input #fileInput type="file" id="fileControl" class="btn btn-primary btn-sm" style="margin-top: 5px; min-width: 100%"
                       [accept]="accept" (change)="pick($event)" />
                <small class="text-danger">Valid Document size &lt; <strong>5 MB</strong> ({{ accept }})</small>
              </div>
              <div class="col-sm-5"></div>
              <div class="col-sm-2"><button type="submit" class="btn btn-primary btn-block w-100" [disabled]="saving()">Save</button></div>
            </div>
          </form>
        </div>
        <div class="col-sm-12">
          <div class="table-responsive">
            <table class="table table-default table-zed table-bordered bg-white">
              <thead>
                <tr>
                  <th>Document Name</th>
                  <th>Document</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (d of documents(); track d.id) {
                  <tr>
                    <th>{{ d.documentName }}</th>
                    <td>
                      @if (d.downloadUrl) {
                        <a [href]="d.downloadUrl" target="_blank" rel="noopener">Download</a>
                      }
                    </td>
                    <td><button type="button" class="btn btn-primary" [disabled]="saving()" (click)="remove(d)">Delete</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="3" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
