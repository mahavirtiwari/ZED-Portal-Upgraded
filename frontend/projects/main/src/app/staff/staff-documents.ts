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
  /** The file's name (2026-11-18), for its type ("PDF"); absent from older APIs. */
  fileName?: string | null;
}

type DocKind = 'file' | 'video' | 'link';
type DocType = 'all' | DocKind;

/** A link the Admin entered is a video when it points to a video site or a video file; any other page is a link. */
const VIDEO_URL = /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

/**
 * Documents (new in V4): the documents and videos the Admin gave to this account type (Admin → Documents/Videos;
 * api/staff/documents). Before V4 the documents went to the MSMEs only.
 * <p>2026-11-17 (approved redesign): one row per document with its type, description and date, and a type filter with
 * counts beside the search. Only the types the API has (files and videos); the design's "Links" filter and the file size
 * are not shown: the API has no link type and returns no size.</p>
 * <p>2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-18 — the search icon on the left, the chips without a
 * "Type" label and with "Links" (a link that is not a video site or video file), the badge with the real type (PDF, DOCX, VIDEO,
 * LINK; from the file name), the meta "PDF · Added 10 Nov 2026" / "Video" / "Opens in a new tab" (the API has no size), the
 * 14.5px dark title, and 130×36 grey buttons with icons: Download, Watch, Open.</p>
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
      <label class="sd-q">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input class="form-control" type="search" placeholder="Search documents" aria-label="Search documents" maxlength="100"
               [ngModel]="search()" (ngModelChange)="search.set($event)" />
      </label>
      <zed-chip-filter class="sd-chips" label="Type" [chips]="chips()" [value]="type()" (valueChange)="type.set($any($event))" />
    </div>
    <div class="sd-list">
      @for (d of shown(); track d.id) {
        @let k = kindOf(d);
        <div class="sd-item">
          <span class="sd-kind" [class.is-video]="k === 'video'" [class.is-link]="k === 'link'" aria-hidden="true">{{ badge(d) }}</span>
          <div class="sd-main">
            <strong>{{ d.documentName }}</strong>
            @if (d.description) { <p class="mb-0">{{ d.description }}</p> }
          </div>
          <span class="sd-meta">
            @switch (k) {
              @case ('video') { Video }
              @case ('link') { Opens in a new tab }
              @default { {{ badge(d) }}@if (d.createdDate) { · Added {{ d.createdDate | date: 'dd MMM yyyy' }}} }
            }
          </span>
          @if (k !== 'file') {
            <a class="btn sd-btn" [href]="d.videoUrl" target="_blank" rel="noopener noreferrer">
              @if (k === 'video') {
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l13 8-13 8V4z" /></svg>Watch
              } @else {
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>Open
              }
            </a>
          } @else if (d.downloadUrl) {
            <a class="btn sd-btn" [href]="d.downloadUrl" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>Download</a>
          }
        </div>
      } @empty {
        @if (loaded()) { <div class="no-data">{{ documents().length ? 'Nothing matches the search.' : 'No documents have been shared with you yet.' }}</div> }
      }
    </div>
  `,
  styles: `
    .sd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin-bottom: 20px; }
    .sd-q { position: relative; flex: 0 1 400px; min-width: 220px; margin: 0; }
    svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .sd-q svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); color: #6f8487; pointer-events: none; }
    .sd-q .form-control { width: 100%; height: 38px; padding: 0 12px 0 36px; border: 1.2px solid #b9cdcf; border-radius: 9px; font-size: 13px; background-image: none; }
    .sd-chips ::ng-deep .cf-label { display: none; }
    .sd-list { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.05); overflow: hidden; }
    .sd-item { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; min-height: 78px; padding: 12px 24px; }
    .sd-item + .sd-item { border-top: 1px solid #dde7e8; }
    .sd-kind { flex: none; width: 58px; height: 38px; display: grid; place-items: center; border-radius: 8px; font-size: 10.5px; font-weight: 800;
      text-transform: uppercase; background: #e6f2f3; color: #24666b; }
    .sd-kind.is-video { background: #fdf2dc; color: #9a5f06; }
    .sd-kind.is-link { background: #ecf0f0; color: #6f8487; }
    .sd-main { flex: 1 1 260px; min-width: 0; }
    .sd-main strong { display: block; color: #17373b; font-size: 14.5px; font-weight: 700; overflow-wrap: anywhere; }
    .sd-main p { margin-top: 2px; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .sd-meta { font-size: 12px; font-weight: 500; color: #6f8487; white-space: nowrap; }
    .sd-btn { width: 130px; min-height: 36px; gap: 6px; background: #e7eeee; border: 1px solid #e7eeee; color: #17373b; font-size: 13px; font-weight: 700; border-radius: 9px; }
    .sd-btn svg { width: 16px; height: 16px; }
    .sd-btn:hover { background: #d9e3e3; border-color: #d9e3e3; color: #10292c; }
    .sd-list .no-data { margin: 0; border: 0; }
    @media (max-width: 575.98px) {
      .sd-item { padding: 12px 16px; }
      .sd-meta { white-space: normal; flex: 1 1 100%; padding-left: 78px; }
      .sd-btn { margin-left: 78px; }
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
  /** All / Files / Videos / Links, with the counts of the documents that match the search. */
  protected readonly chips = computed<FilterChip[]>(() => {
    const list = this.matching();
    const count = (k: DocKind) => list.filter((d) => this.kindOf(d) === k).length;
    return [
      { key: 'all', label: 'All', count: list.length },
      { key: 'file', label: 'Files', count: count('file') },
      { key: 'video', label: 'Videos', count: count('video') },
      { key: 'link', label: 'Links', count: count('link') },
    ];
  });
  protected readonly shown = computed(() => {
    const t = this.type();
    return this.matching().filter((d) => t === 'all' || this.kindOf(d) === t);
  });

  /** A file, a video (a video site or file) or a link (any other page). */
  protected kindOf(d: StaffDocument): DocKind {
    if (!d.videoUrl) return 'file';
    return VIDEO_URL.test(d.videoUrl) ? 'video' : 'link';
  }

  /** The badge: the file's type from its name ("PDF", "DOCX"), "Video" or "Link"; "File" when the name has no type. */
  protected badge(d: StaffDocument): string {
    const k = this.kindOf(d);
    if (k !== 'file') return k === 'video' ? 'Video' : 'Link';
    const ext = /\.([a-z0-9]{2,5})$/i.exec((d.fileName ?? '').trim())?.[1];
    return ext ? ext.toUpperCase() : 'File';
  }
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
