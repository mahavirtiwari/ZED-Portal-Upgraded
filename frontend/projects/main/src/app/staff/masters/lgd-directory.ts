import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MessageResponse, PortalLinksService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';

export type ChangeKind = 'addState' | 'renameState' | 'addDistrict' | 'renameDistrict' | 'deactivateDistrict';

export interface LgdChange {
  kind: ChangeKind;
  stateCode: string;
  stateName: string | null;
  districtCode: string | null;
  districtName: string | null;
  oldName: string | null;
}

export interface LgdPreview {
  statesInFile: number;
  districtsInFile: number;
  changes: LgdChange[];
}

const KIND_LABELS: Record<ChangeKind, string> = {
  addState: 'New state / UT',
  renameState: 'State renamed',
  addDistrict: 'New district',
  renameDistrict: 'District renamed',
  deactivateDistrict: 'No longer in LGD (deactivate)',
};

/** Colour of each kind's badge and card: new (green), renamed (teal), no longer in LGD (red). */
const KIND_TONES: Record<ChangeKind, string> = {
  addState: 'is-new',
  renameState: 'is-rename',
  addDistrict: 'is-new',
  renameDistrict: 'is-rename',
  deactivateDistrict: 'is-drop',
};

/**
 * Admin → Masters → LG Directory (new in V4): brings the States and Districts masters up to date with the Local
 * Government Directory. LGD has no open web service, so the Admin downloads its district list and uploads it; the page
 * shows what differs and applies only the ticked changes. V4 layout: the three steps as numbered cards (the current one
 * marked), an upload box showing the chosen file, the file's counts, a card per kind of change (ticks all of that kind)
 * and a coloured badge per change.
 */
@Component({
  selector: 'zed-staff-lgd-directory',
  imports: [PagerComponent, ListSearchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">LG Directory</h3>
        <p class="page-sub">Bring the states and districts up to date with the Local Government Directory (LGD).</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <ol class="lgd-steps">
      <li class="lgd-step" [class.is-done]="!!fileName()">
        <span class="lgd-no" aria-hidden="true">1</span>
        <div><strong>Download from LGD</strong>
          <span>On @if (links.url('lgd'); as u) {<a [href]="u" target="_blank" rel="noopener noreferrer">lgdirectory.gov.in → Download Directory</a>} @else {lgdirectory.gov.in → Download Directory}, download the list of <b>all districts</b> (CSV or Excel).</span></div>
      </li>
      <li class="lgd-step" [class.is-now]="!result()" [class.is-done]="!!result()">
        <span class="lgd-no" aria-hidden="true">2</span>
        <div><strong>Upload and check</strong><span>Upload it here and check the changes.</span></div>
      </li>
      <li class="lgd-step" [class.is-now]="!!result()">
        <span class="lgd-no" aria-hidden="true">3</span>
        <div><strong>Tick and apply</strong><span>Tick the changes to make and apply them. Codes are LGD codes; names are stored in capitals.</span></div>
      </li>
    </ol>

    <section class="zed-card">
      <div class="lgd-upload">
        <label class="lgd-drop" for="lgd-file" [class.has-file]="!!fileName()">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 17v-6" /><path d="m9 14 3-3 3 3" />
          </svg>
          <span class="lgd-drop-text">
            @if (fileName(); as f) { <strong>{{ f }}</strong> <small class="muted">Choose another file to replace it.</small> }
            @else { <strong>Choose the LGD district list</strong> <small class="muted">CSV or Excel (.xlsx), as downloaded from LGD.</small> }
          </span>
        </label>
        <input type="file" class="form-control" id="lgd-file" accept=".csv,.xlsx" aria-label="LGD district list" (change)="pickFile($event)" />
        <button type="button" class="btn btn-primary" [disabled]="busy() || !file" (click)="preview()">Check changes</button>
      </div>
    </section>

    @if (result(); as r) {
      <div class="lgd-stats">
        <div class="stat"><span class="stat-value">{{ r.statesInFile }}</span><span class="stat-label">States / UTs in the file</span></div>
        <div class="stat"><span class="stat-value">{{ r.districtsInFile }}</span><span class="stat-label">Districts in the file</span></div>
        <div class="stat" [class.stat-warn]="r.changes.length"><span class="stat-value">{{ r.changes.length }}</span><span class="stat-label">Changes found</span></div>
      </div>
      <section class="zed-card" aria-labelledby="lgd-changes">
        <h5 class="lgd-h" id="lgd-changes">Changes</h5>
        @if (!r.changes.length) {
          <div class="no-data">The states and districts already match LGD. Nothing to apply.</div>
        } @else {
          <div class="lgd-summary">
            @for (k of kinds(); track k.kind) {
              <label class="lgd-kind {{ toneOf(k.kind) }}" [class.is-on]="allTicked(k.kind)">
                <input type="checkbox" class="form-check-input" [checked]="allTicked(k.kind)" (change)="tickKind(k.kind, $any($event.target).checked)" />
                <span class="lgd-kind-name">{{ k.label }}</span>
                <span class="lgd-kind-count">{{ k.count }}</span>
              </label>
            }
          </div>
          <p class="muted lgd-hint">New and renamed entries are ticked. Tick a district no longer in LGD only when it has really gone.</p>
          <zed-list-search [(value)]="search" placeholder="Search changes" inputId="lgd-search" [found]="list.total()" />
          <div class="table-responsive lgd-list">
            <table class="table table-zed">
              <thead><tr><th style="width: 40px"></th><th>Change</th><th>State / UT</th><th>District</th><th>Now in ZED</th></tr></thead>
              <tbody>
                @for (row of list.page(); track row.i) {
                  @let c = row.c;
                  @let i = row.i;
                  <tr [class.is-ticked]="ticked().has(i)">
                    <td><input type="checkbox" class="form-check-input" [attr.aria-label]="'Apply ' + labelOf(c)" [checked]="ticked().has(i)" (change)="tick(i)" /></td>
                    <td><span class="lgd-badge {{ toneOf(c.kind) }}">{{ kindLabel(c.kind) }}</span></td>
                    <td>{{ c.stateName }} <small class="muted">({{ c.stateCode }})</small></td>
                    <td>{{ c.districtName }} @if (c.districtCode) { <small class="muted">({{ c.districtCode }})</small> }</td>
                    <td class="muted">@if (c.oldName) { <s>{{ c.oldName }}</s> } @else { {{ c.kind.startsWith('add') ? '—' : '' }} }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <zed-pager [pager]="list" [sizes]="[20, 50, 100, 500]" />
          <div class="form-actions lgd-bar">
            <span class="me-auto lgd-count"><strong>{{ ticked().size }}</strong> of {{ r.changes.length }} ticked</span>
            <button type="button" class="btn btn-primary" [disabled]="busy() || !ticked().size" (click)="apply()">Apply ticked changes</button>
          </div>
        }
      </section>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .zed-card { margin-bottom: 16px; }

    /* The three steps; the current one is outlined, the ones done have a green number. */
    .lgd-steps { list-style: none; padding: 0; margin: 0 0 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .lgd-step { display: flex; gap: 12px; align-items: flex-start; background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 14px; min-width: 0; }
    .lgd-step > div { min-width: 0; font-size: 13.5px; color: #3b4b4c; overflow-wrap: anywhere; }
    .lgd-step > div > strong { display: block; color: #23474a; font-size: 14.5px; margin-bottom: 2px; }
    .lgd-no { flex: 0 0 30px; width: 30px; height: 30px; border-radius: 15px; display: inline-grid; place-items: center; font-weight: 800; font-size: 14px;
      background: #eef6f6; color: #2f7c83; }
    .lgd-step.is-now { border-color: #45a5ad; box-shadow: 0 0 0 1px #45a5ad inset; background: #f7fbfb; }
    .lgd-step.is-now .lgd-no { background: #45a5ad; color: #fff; }
    .lgd-step.is-done .lgd-no { background: #e6f6ec; color: #1e7a3c; }

    /* The upload box is the label of the (hidden) file input and shows the chosen file. */
    .lgd-upload { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .lgd-upload input[type=file] { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; }
    .lgd-drop:has(+ input:focus-visible) { outline: 2px solid #45a5ad; outline-offset: 2px; }
    .lgd-drop { display: flex; align-items: center; gap: 14px; margin: 0; padding: 16px 18px; border: 2px dashed #cbd9da; border-radius: 12px;
      background: #f7fbfb; color: #45a5ad; cursor: pointer; font-weight: 400; }
    .lgd-drop:hover { border-color: #45a5ad; background: #eef6f6; }
    .lgd-drop.has-file { border-style: solid; border-color: #b9dfc8; background: #f3faf5; color: #2e9e5b; }
    .lgd-drop svg { flex: none; }
    .lgd-drop-text { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
    .lgd-drop-text strong { color: #23474a; }

    .lgd-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-label { font-size: 13px; color: #5f6f70; }
    .stat-warn { background: #fffaf0; border-color: #f0dca6; }
    .stat-warn .stat-value { color: #8a6100; }

    .lgd-h { font-weight: 700; color: #23474a; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .lgd-summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; margin-bottom: 8px; }
    .lgd-kind { display: flex; align-items: center; gap: 10px; margin: 0; padding: 10px 12px; border: 1px solid #dfe9ea; border-left: 4px solid #cbd9da; border-radius: 10px;
      background: #fff; cursor: pointer; font-weight: 400; color: #232527; }
    .lgd-kind.is-on { background: #f7fbfb; }
    .lgd-kind.is-new { border-left-color: #2e9e5b; }
    .lgd-kind.is-rename { border-left-color: #45a5ad; }
    .lgd-kind.is-drop { border-left-color: #a8303a; }
    .lgd-kind-name { flex: 1 1 auto; font-size: 13.5px; font-weight: 600; }
    .lgd-kind-count { flex: none; min-width: 26px; text-align: center; font-size: 12px; font-weight: 700; border-radius: 10px; padding: 1px 8px; background: #eef6f6; color: #23474a; }
    .lgd-kind .form-check-input, .lgd-list .form-check-input { float: none; margin: 0; flex: none; }
    .lgd-hint { font-size: 13px; margin-bottom: 8px; }

    .lgd-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 10px; padding: 2px 9px; white-space: nowrap; }
    .lgd-badge.is-new { background: #e6f6ec; color: #1e7a3c; }
    .lgd-badge.is-rename { background: #eef6f6; color: #2f7c83; }
    .lgd-badge.is-drop { background: #fdeef0; color: #a8303a; }
    .lgd-list table { min-width: 680px; }
    .lgd-list td { vertical-align: middle; overflow-wrap: anywhere; }
    .lgd-list tr.is-ticked { background: #f7fbfb; }
    .lgd-list s { color: #8a9899; text-decoration: line-through; }

    .form-actions { align-items: center; }
    .lgd-bar { position: sticky; bottom: 0; background: #fff; border-top: 1px solid #dfe9ea; padding: 12px 0 4px; z-index: 2; }
    .lgd-count { color: #5f6f70; }
    .lgd-count strong { color: #23474a; font-size: 16px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }

    @media (max-width: 767.98px) {
      .lgd-steps { grid-template-columns: minmax(0, 1fr); }
      .lgd-stats { gap: 8px; }
      .stat { padding: 10px 12px; }
      .stat-value { font-size: 20px; }
      .lgd-upload { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class LgdDirectoryPage {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/masters/lgd';

  protected file: File | null = null;
  /** The chosen file's name and size, shown in the upload box. */
  protected readonly fileName = signal('');
  protected readonly result = signal<LgdPreview | null>(null);
  protected readonly ticked = signal<Set<number>>(new Set());
  protected readonly kinds = computed(() => {
    const changes = this.result()?.changes ?? [];
    return (Object.keys(KIND_LABELS) as ChangeKind[])
      .map((kind) => ({ kind, label: KIND_LABELS[kind], count: changes.filter((c) => c.kind === kind).length }))
      .filter((k) => k.count > 0);
  });
  /** The changes with their place in the file's list (the ticks), paged; ticking keeps the page. */
  private readonly indexed = computed(() => (this.result()?.changes ?? []).map((c, i) => ({ c, i })));
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly list = new PagedView(() => searchRows(this.indexed(), this.search()), 20);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  protected kindLabel(kind: ChangeKind): string {
    return KIND_LABELS[kind];
  }

  protected toneOf(kind: ChangeKind): string {
    return KIND_TONES[kind];
  }

  protected labelOf(c: LgdChange): string {
    return `${KIND_LABELS[c.kind]} ${c.districtName ?? c.stateName ?? ''}`.trim();
  }

  protected pickFile(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.fileName.set(this.file ? `${this.file.name} (${sizeOf(this.file.size)})` : '');
    this.error.set('');
  }

  protected allTicked(kind: ChangeKind): boolean {
    const changes = this.result()?.changes ?? [];
    const idx = changes.map((c, i) => (c.kind === kind ? i : -1)).filter((i) => i >= 0);
    return idx.length > 0 && idx.every((i) => this.ticked().has(i));
  }

  protected tickKind(kind: ChangeKind, on: boolean): void {
    const next = new Set(this.ticked());
    (this.result()?.changes ?? []).forEach((c, i) => {
      if (c.kind !== kind) return;
      if (on) next.add(i);
      else next.delete(i);
    });
    this.ticked.set(next);
  }

  protected tick(i: number): void {
    const next = new Set(this.ticked());
    if (!next.delete(i)) next.add(i);
    this.ticked.set(next);
  }

  protected async preview(): Promise<void> {
    if (!this.file) return;
    const form = new FormData();
    form.append('file', this.file, this.file.name);
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.post<LgdPreview>(`${LgdDirectoryPage.url}/preview`, form));
      this.result.set(r);
      // New and renamed entries are ticked; deactivations are left for the Admin to tick.
      this.ticked.set(new Set(r.changes.map((c, i) => (c.kind === 'deactivateDistrict' ? -1 : i)).filter((i) => i >= 0)));
    } catch (err) {
      this.result.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async apply(): Promise<void> {
    const r = this.result();
    if (!r) return;
    const changes = r.changes.filter((_, i) => this.ticked().has(i));
    if (!confirm(`Apply ${changes.length} change(s) to the states and districts?`)) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.success.set((await firstValueFrom(this.http.post<MessageResponse>(`${LgdDirectoryPage.url}/apply`, { changes }))).message);
      this.result.set(null);
      this.ticked.set(new Set());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

function sizeOf(bytes: number): string {
  return bytes < 1024 ? 'under 1 KB' : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
