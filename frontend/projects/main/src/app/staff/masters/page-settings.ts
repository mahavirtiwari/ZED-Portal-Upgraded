import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MastersApi, PageSettings } from './masters.api';

export const BANNER_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Home (login) page banner (Admin). Port of Views/Home/PageSettings.cshtml. The old page uploaded any
 * file and then saved whatever path the browser sent; now one request uploads a PNG and the API names it. V4: the
 * upload and the current banner in one card.
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
    <form class="zed-card" (submit)="$event.preventDefault(); save()" novalidate>
      <div class="form-grid">
        <label for="fileControl">Home page Image<span class="req">*</span></label>
        <div>
          <input #fileInput type="file" id="fileControl" class="form-control" accept=".png,image/png" (change)="pick($event)" />
          <small class="text-danger">Valid Image Type <strong>(.png)</strong>, up to 3 MB</small>
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" [disabled]="saving()">Save</button>
      </div>
      <div class="banner">
        @if (preview(); as url) {
          <img [src]="url" height="300" alt="Selected banner (not saved yet)" />
        } @else if (settings()?.imageUrl; as url) {
          <a target="_blank" rel="noopener" [href]="url"><img [src]="url" height="300" alt="Current home page banner" /></a>
          @if (settings()?.updatedOn) { <small class="d-block text-muted mt-1">Saved on {{ settings()?.updatedOn }}</small> }
        } @else {
          <span class="text-muted">No banner saved.</span>
        }
      </div>
    </form>
    @if (saving()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Saving…</span></div>
    }
  `,
  styles: `
    .banner { border-top: 1px solid #e8eff0; margin-top: 16px; padding-top: 16px; }
    .banner img { max-width: 100%; height: auto; max-height: 300px; border-radius: 8px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class PageSettingsPage {
  private readonly api = inject(MastersApi);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly settings = signal<PageSettings | null>(null);
  protected readonly preview = signal<string | null>(null);
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
    if (file && typeof URL.createObjectURL === 'function') this.setPreview(URL.createObjectURL(file));
  }

  private setPreview(url: string | null): void {
    const old = this.preview();
    if (old && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(old);
    this.preview.set(url);
  }

  private clearFile(): void {
    this.file = null;
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
