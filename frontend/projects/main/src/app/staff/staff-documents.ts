import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardPortalSwitchComponent } from './dashboard-portal-switch';
import { PageHead } from '../msme/shared/page-head';
import { staffCrumbs } from './staff-crumbs';
import { ChipFilter, FilterChip } from './chip-filter';

export interface StaffDocument {
  id: number;
  documentName: string;
  description: string | null;
  downloadUrl: string | null;
  videoUrl: string | null;
  createdDate: string | null;
}

type DocType = 'all' | 'file' | 'video';

/**
 * Documents (new in V4): the documents and videos the Admin gave to this account type (Admin → Documents/Videos;
 * api/staff/documents). Before V4 the documents went to the MSMEs only.
 * <p>2026-11-17 (approved redesign): one row per document with its type, description and date, and a type filter with
 * counts beside the search. Only the types the API has (files and videos); the design's "Links" filter and the file size
 * are not shown: the API has no link type and returns no size.</p>
 */
@Component({
  selector: 'zed-staff-role-documents',
  imports: [FormsModule, DatePipe, DashboardPortalSwitchComponent, PageHead, ChipFilter],
  template: `
    <!-- One Dashboard Admin (2026-11-07): the portal of this screen. -->
    <zed-dashboard-portal-switch [screens]="['documents']" />
    <zed-page-head [crumbs]="crumbs" title="Documents" subtitle="Guidelines, documents and videos shared with you by the ZED team." />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    <div class="sd-bar">
      <input class="form-control sd-q" type="search" placeholder="Search documents" aria-label="Search documents" maxlength="100"
             [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <zed-chip-filter label="Type" [chips]="chips()" [value]="type()" (valueChange)="type.set($any($event))" />
    </div>
    <div class="sd-list">
      @for (d of shown(); track d.id) {
        <div class="sd-item">
          <span class="sd-kind" [class.video]="!!d.videoUrl" aria-hidden="true">{{ d.videoUrl ? 'Video' : 'File' }}</span>
          <div class="sd-main">
            <strong>{{ d.documentName }}</strong>
            @if (d.description) { <p class="mb-0">{{ d.description }}</p> }
          </div>
          <span class="sd-meta">
            @if (d.videoUrl) { Video · opens in a new tab } @else { File@if (d.createdDate) { · Added {{ d.createdDate | date: 'dd MMM yyyy' }}} }
          </span>
          @if (d.videoUrl) {
            <a class="btn sd-btn" [href]="d.videoUrl" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▷</span> Watch</a>
          } @else if (d.downloadUrl) {
            <a class="btn sd-btn" [href]="d.downloadUrl" target="_blank" rel="noopener"><span aria-hidden="true">↓</span> Download</a>
          }
        </div>
      } @empty {
        @if (loaded()) { <div class="no-data">{{ documents().length ? 'Nothing matches the search.' : 'No documents have been shared with you yet.' }}</div> }
      }
    </div>
  `,
  styles: `
    .sd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin-bottom: 16px; }
    .sd-q { flex: 0 1 400px; min-width: 220px; }
    .sd-list { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; overflow: hidden; }
    .sd-item { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; padding: 16px 20px; }
    .sd-item + .sd-item { border-top: 1px solid #e6eeee; }
    .sd-kind { flex: none; width: 58px; padding: 9px 0; border-radius: 8px; text-align: center; font-size: 11.5px; font-weight: 800; text-transform: uppercase;
      letter-spacing: .4px; background: color-mix(in srgb, var(--zt-soft, #d4ebe6) 60%, #fff); color: var(--zt-dark, #1f5c61); }
    .sd-kind.video { background: #fdf1dc; color: #a86a12; }
    .sd-main { flex: 1 1 260px; min-width: 0; }
    .sd-main strong { display: block; color: var(--zt-ink, #173f44); font-size: 15px; overflow-wrap: anywhere; }
    .sd-main p { font-size: 13.5px; color: #3d5254; }
    .sd-meta { font-size: 12.5px; color: #5f6f70; white-space: nowrap; }
    .sd-btn { min-width: 128px; background: #eef4f4; color: var(--zt-ink, #173f44); font-weight: 700; border-radius: 8px; }
    .sd-btn:hover { background: var(--zt-soft, #d4ebe6); }
    .sd-list .no-data { margin: 0; border: 0; }
    @media (max-width: 575.98px) {
      .sd-meta { white-space: normal; flex: 1 1 100%; padding-left: 76px; }
      .sd-btn { margin-left: 76px; }
    }
  `,
})
export class StaffRoleDocumentsPage {
  private readonly http = inject(HttpClient);

  protected readonly crumbs = staffCrumbs({ label: 'Documents' });
  protected readonly documents = signal<StaffDocument[]>([]);
  protected readonly search = signal('');
  protected readonly type = signal<DocType>('all');
  private readonly matching = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.documents().filter((d) => !q || d.documentName.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q));
  });
  /** All / Files / Videos, with the counts of the documents that match the search. */
  protected readonly chips = computed<FilterChip[]>(() => {
    const list = this.matching();
    const videos = list.filter((d) => !!d.videoUrl).length;
    return [
      { key: 'all', label: 'All', count: list.length },
      { key: 'file', label: 'Files', count: list.length - videos },
      { key: 'video', label: 'Videos', count: videos },
    ];
  });
  protected readonly shown = computed(() => {
    const t = this.type();
    return this.matching().filter((d) => t === 'all' || (t === 'video') === !!d.videoUrl);
  });
  protected readonly loaded = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.documents.set(await firstValueFrom(this.http.get<StaffDocument[]>('/api/staff/documents')));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loaded.set(true);
    }
  }
}
