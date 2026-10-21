import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MastersApi, PageSettings } from './masters.api';

export const BANNER_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Home (login) page banner (Admin). Port of Views/Home/PageSettings.cshtml. The old page uploaded any
 * file and then saved whatever path the browser sent; now one request uploads a PNG and the API names it.
 */
@Component({
  selector: 'zed-staff-page-settings',
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="mt-3">
        <div class="row">
          <h3 class="col-sm-12 text-center">Home Page</h3>
          @if (error()) {
            <div class="col-sm-12"><div class="alert alert-danger" role="alert">{{ error() }}</div></div>
          }
          @if (success()) {
            <div class="col-sm-12"><div class="alert alert-success" role="status">{{ success() }}</div></div>
          }
          <form class="jumbotron" (submit)="$event.preventDefault(); save()" novalidate>
            <div class="row mb-3">
              <div class="col-sm-12" style="margin-bottom: 9px"><label for="fileControl">Home page Image <span style="color: red">*</span></label></div>
              <div class="col-sm-6">
                <input #fileInput type="file" id="fileControl" class="btn btn-primary btn-sm" style="margin-top: 5px; min-width: 100%"
                       accept=".png,image/png" (change)="pick($event)" />
                <small class="text-danger">Valid Image Type <strong>(.png)</strong>, up to 3 MB</small>
              </div>
            </div>
            <div class="row align-items-end mb-3">
              <div class="col"><button type="submit" class="btn btn-primary btn-block" [disabled]="saving()">Save</button></div>
            </div>
            <div class="row">
              @if (preview(); as url) {
                <span><img [src]="url" height="300" alt="Selected banner (not saved yet)" /></span>
              } @else if (settings()?.imageUrl; as url) {
                <span>
                  <a target="_blank" rel="noopener" [href]="url"><img [src]="url" height="300" alt="Current home page banner" /></a>
                  @if (settings()?.updatedOn) { <br /><small class="text-muted">Saved on {{ settings()?.updatedOn }}</small> }
                </span>
              } @else {
                <span class="text-muted">No banner saved.</span>
              }
            </div>
          </form>
        </div>
      </div>
    </div>
    @if (saving()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Saving…</span></div>
    }
  `,
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
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
