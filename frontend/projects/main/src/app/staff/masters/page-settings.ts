import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MastersApi, PageSettings } from './masters.api';

export const BANNER_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Home (login) page banner (Admin). Port of Views/Home/PageSettings.cshtml. The old page uploaded any
 * file and then saved whatever path the browser sent; now one request uploads a PNG and the API names it. V4 layout: the
 * current banner as a card (its preview, where it is shown, the file and when it was saved) beside an upload card with
 * a drop area, the format and size hints, and the chosen image previewed before it is saved.
 */
@Component({
  selector: 'zed-staff-page-settings',
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Home Page</h3>
        <p class="page-sub">The banner image shown on the portal's home (login) page.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <div class="ps-grid">
      <section class="zed-card img-card" aria-labelledby="ps-current-h">
        <div class="img-card-head">
          <h5 class="ps-h m-0" id="ps-current-h">Current banner</h5>
          @if (settings()?.imageUrl) {
            <span class="status-badge is-active">In use</span>
          } @else if (settings()) {
            <span class="status-badge is-inactive">None saved</span>
          }
        </div>
        <div class="img-frame">
          @if (settings()?.imageUrl; as url) {
            <a target="_blank" rel="noopener" [href]="url" title="Open full size"><img [src]="url" alt="Current home page banner" /></a>
          } @else {
            <div class="img-empty">
              <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="m3 16 5-5 4 4 3-3 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><circle cx="16" cy="9.5" r="1.6" fill="currentColor" /></svg>
              <span>No banner saved. Choose a PNG to add one.</span>
            </div>
          }
        </div>
        <dl class="img-meta">
          <dt>Shown on</dt>
          <dd><span class="zed-chip">Home (login) page</span></dd>
          @if (settings()?.fileName) {
            <dt>File</dt>
            <dd>{{ settings()?.fileName }}</dd>
          }
          @if (settings()?.updatedOn) {
            <dt>Saved on</dt>
            <dd>{{ settings()?.updatedOn }}</dd>
          }
        </dl>
        @if (settings()?.imageUrl; as url) {
          <a class="btn btn-sm btn-outline-primary" target="_blank" rel="noopener" [href]="url">Open full size</a>
        }
      </section>

      <form class="zed-card img-card" aria-labelledby="ps-upload-h" (submit)="$event.preventDefault(); save()" novalidate>
        <div class="img-card-head">
          <h5 class="ps-h m-0" id="ps-upload-h">{{ settings()?.imageUrl ? 'Replace the banner' : 'Add a banner' }}</h5>
          @if (preview()) { <span class="status-badge is-pending">Not saved yet</span> }
        </div>
        @if (preview(); as url) {
          <div class="img-frame picked">
            <img [src]="url" alt="Selected banner (not saved yet)" />
          </div>
          <p class="picked-name">{{ picked()?.name }} <span class="muted">· {{ picked()?.size }}</span></p>
        }
        <label class="drop" [class.compact]="preview()" for="fileControl">
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span class="drop-title">{{ preview() ? 'Choose another image' : 'Choose a PNG image, or drop it here' }}<span class="req">*</span></span>
          <input #fileInput type="file" id="fileControl" accept=".png,image/png" (change)="pick($event)" />
        </label>
        <ul class="hints" aria-label="Image rules">
          <li><span class="hint-chip">PNG only</span></li>
          <li><span class="hint-chip">Up to 3 MB</span></li>
          <li class="muted">Saving replaces the current banner at once.</li>
        </ul>
        <div class="form-actions">
          @if (preview()) {
            <button type="button" class="btn btn-default" [disabled]="saving()" (click)="discard()">Cancel</button>
          }
          <button type="submit" class="btn btn-primary" [disabled]="saving()">Save</button>
        </div>
      </form>
    </div>
    @if (saving()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Saving…</span></div>
    }
  `,
  styles: `
    .ps-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .img-card { display: flex; flex-direction: column; gap: 12px; margin: 0; }
    .img-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .ps-h { font-weight: 700; color: #23474a; }
    .img-frame { border: 1px solid #dfe9ea; border-radius: 10px; overflow: hidden; background: #f4f8f8; aspect-ratio: 16 / 6; display: grid; place-items: center; }
    .img-frame a { display: block; width: 100%; height: 100%; }
    .img-frame img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .img-frame.picked { border: 2px solid #45a5ad; }
    .img-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #5f6f70; font-size: 14px; text-align: center; padding: 16px; }
    .img-empty svg { color: #8a9899; }
    .img-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 16px; margin: 0; font-size: 14px; }
    .img-meta dt { font-weight: 600; color: #5f6f70; }
    .img-meta dd { margin: 0; color: #232527; overflow-wrap: anywhere; }
    .img-card > .btn { align-self: flex-start; }
    .picked-name { margin: -4px 0 0; font-weight: 600; color: #23474a; overflow-wrap: anywhere; }

    /* The drop area: the file input covers it, so a click opens the picker and a dropped file is taken. */
    .drop { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 0; padding: 30px 16px; text-align: center;
      border: 2px dashed #b9d3d5; border-radius: 12px; background: #f8fbfb; color: #2f7c83; cursor: pointer; }
    .drop.compact { flex-direction: row; justify-content: center; padding: 12px 16px; }
    .drop:hover, .drop:focus-within { border-color: #45a5ad; background: #f1f8f8; }
    .drop-title { font-weight: 600; color: #23474a; }
    .drop input[type=file] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    .hints { list-style: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0; padding: 0; font-size: 13px; }
    .hint-chip { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 10px; background: #eef6f6; color: #2f7c83; }
    .form-actions { margin-top: 0; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 991.98px) { .ps-grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class PageSettingsPage {
  private readonly api = inject(MastersApi);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly settings = signal<PageSettings | null>(null);
  protected readonly preview = signal<string | null>(null);
  /** The chosen file's name and size (shown under its preview). */
  protected readonly picked = signal<{ name: string; size: string } | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  private file: File | null = null;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.settings.set(await firstValueFrom(this.api.pageSettings()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected pick(event: Event): void {
    this.error.set('');
    this.success.set('');
    this.setPreview(null);
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (file && (!/\.png$/i.test(file.name) || file.size > BANNER_MAX_BYTES)) {
      this.error.set('Please upload valid document.');
      this.clearFile();
      return;
    }
    this.file = file;
    this.picked.set(file ? { name: file.name, size: file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB` } : null);
    if (file && typeof URL.createObjectURL === 'function') this.setPreview(URL.createObjectURL(file));
  }

  /** Cancel: drops the chosen image; the current banner stays. */
  protected discard(): void {
    this.clearFile();
    this.setPreview(null);
  }

  private setPreview(url: string | null): void {
    const old = this.preview();
    if (old && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(old);
    this.preview.set(url);
  }

  private clearFile(): void {
    this.file = null;
    this.picked.set(null);
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  protected async save(): Promise<void> {
    this.error.set('');
    this.success.set('');
    if (!this.file) {
      this.error.set('Please enter valid data.');
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.saveBanner(this.file))).message);
      this.clearFile();
      this.setPreview(null);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
