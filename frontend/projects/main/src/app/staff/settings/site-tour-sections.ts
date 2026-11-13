import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { AdminPortalService, PortalSwitchComponent, SITE_TOUR_PORTALS } from '../admin-portal';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';

/** A section of the site tour (Zed.Core.Assessment.SiteTourSection). Empty levels / sectors: all. */
export interface SiteTourSection {
  /** Stable key (never changed once saved). */
  id: string;
  title: string;
  /** What to capture. */
  hint: string | null;
  min: number;
  max: number;
  levels: string[];
  nicSectors: string[];
  active: boolean;
}

export interface SiteTourSectionsResponse {
  sections: SiteTourSection[];
  /** The certification levels a section can be limited to (Bronze has no site tour). */
  levels: { code: string; name: string }[];
  /** False while the standard sections are in use (nothing saved yet). */
  customised: boolean;
}

/** The server's limits (Zed.Core.Assessment.SiteTourSections). */
export const SITE_TOUR_LIMITS = { sections: 30, title: 100, hint: 200, photos: 50 } as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

interface Editing {
  /** Null: a new section. */
  section: SiteTourSection | null;
  title: string;
  hint: string;
  min: number | null;
  max: number | null;
  levels: string[];
  nicSectors: string[];
  active: boolean;
  /** "Only these levels / sectors" chosen (the lists show); off empties the list. */
  limitLevels: boolean;
  limitSectors: boolean;
}

/** The problems of the pop-up's fields, as the server's rules (SiteTourSections.Problem). */
export interface SectionProblems {
  title?: string;
  hint?: string;
  min?: string;
  max?: string;
  active?: string;
}

/** A key for a new section from its name: "Paint Shop" → "paint-shop" (with -2, -3… when taken). */
export function sectionId(title: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40).replace(/[-_]+$/, '') || 'section';
  if (!used.has(base) && ID_PATTERN.test(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = base.slice(0, 40 - suffix.length).replace(/[-_]+$/, '') + suffix;
    if (!used.has(id) && ID_PATTERN.test(id)) return id;
  }
}

/**
 * Admin → Site Tour Sections (new in V4): the sections the site assessor app files the site tour photos under, the photos
 * each needs (minimum) and takes (maximum), and the certification levels and NIC sectors each is asked of (none = all).
 * Laid out as App Forms: a row per section with its scope as chips, moved up and down, and a pop-up to add or edit one.
 * Each change saves the whole list (PUT); "Reset to standard sections" goes back to the ten of the redesigned app.
 * One Admin (V4): the portal switch picks the ZED Certification, the Consultancy (the consultant app's site tour, milestone 1)
 * or the Surveillance portal's sections.
 */
@Component({
  selector: 'zed-staff-site-tour-sections',
  imports: [FormsModule, MultiSelect, PortalSwitchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Site tour sections</h3>
        <p class="page-sub">The sections the {{ appName() }} files site tour photos under, with the photos each needs. Limit a section to levels and NIC sectors.</p>
      </div>
      @if (data(); as d) {
        <div class="page-actions">
          <button type="button" class="btn btn-default" [disabled]="!d.customised || busy()" (click)="resetAll()">Reset to standard sections</button>
          <button type="button" class="btn btn-primary" [disabled]="d.sections.length >= limits.sections || busy()" [title]="d.sections.length >= limits.sections ? 'At most ' + limits.sections + ' sections' : ''" (click)="add()">Add section</button>
        </div>
      }
    </div>
    <!-- One Admin (V4): the portal whose sections these are (ZED Certification and Surveillance keep their own). -->
    <zed-portal-switch [portals]="portals" />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (data(); as d) {
      <p class="sync-note">
        <span class="info-dot" aria-hidden="true">i</span>
        @if (!d.customised) { <span class="standard-note">Standard sections (not changed yet).</span> }
        A change reaches the app when an assessment is next opened.
      </p>
      <div class="table-responsive">
        <table class="table table-zed sections-table">
          <colgroup>
            <col style="width: 56px" />
            <col />
            <col style="width: 70px" />
            <col style="width: 70px" />
            <col style="width: 260px" />
            <col style="width: 150px" />
          </colgroup>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th>Section</th>
              <th class="text-center">Min</th>
              <th class="text-center">Max</th>
              <th>Used for</th>
              <th class="text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            @for (s of d.sections; track s.id; let i = $index, last = $last) {
              <tr [class.is-off]="!s.active" [attr.data-id]="s.id">
                <td class="text-center"><span class="order-no">{{ i + 1 }}</span></td>
                <td>
                  <div class="section-title">
                    <strong>{{ s.title }}</strong>
                    @if (!s.active) { <span class="status-badge is-inactive">Off</span> }
                  </div>
                  @if (s.hint) { <small class="section-hint">{{ s.hint }}</small> }
                </td>
                <td class="text-center num">{{ s.min }}</td>
                <td class="text-center num">{{ s.max }}</td>
                <td>
                  <div class="scope" [title]="scopeText(s)">
                    @if (!s.levels.length && !s.nicSectors.length) {
                      <span class="scope-all">All levels · All sectors</span>
                    } @else {
                      @if (s.levels.length) {
                        @for (l of s.levels; track l) { <span class="zed-chip">{{ levelName(l) }}</span> }
                      } @else {
                        <span class="scope-all">All levels</span>
                      }
                      @if (s.nicSectors.length) {
                        @for (c of s.nicSectors; track c) { <span class="zed-chip sector">NIC {{ c }}</span> }
                      } @else {
                        <span class="scope-all">All sectors</span>
                      }
                    }
                  </div>
                </td>
                <td>
                  <div class="row-actions justify-content-center">
                    <span class="move">
                      <button type="button" class="btn btn-default" title="Move up" aria-label="Move up" [disabled]="i === 0 || busy()" (click)="move(i, -1)">↑</button>
                      <button type="button" class="btn btn-default" title="Move down" aria-label="Move down" [disabled]="last || busy()" (click)="move(i, 1)">↓</button>
                    </span>
                    <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="edit(s)">Edit</button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" style="padding: 0"><div class="no-data">No sections</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="totals">{{ totals() }}</p>
    } @else if (!busy()) {
      <div class="no-data">The site tour sections could not be loaded</div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sectionTitle">
        <div class="modal-dialog modal-lg modal-dialog-scrollable section-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-start gap-3">
                <h3 class="registration-title m-0" id="sectionTitle">{{ e.section ? 'Edit section' : 'Add section' }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              @let p = check(e);
              <div>
                <div class="form-grid">
                  <label for="sectionName">Section name<span class="req">*</span></label>
                  <div>
                    <input type="text" class="form-control" id="sectionName" [maxlength]="limits.title" placeholder="e.g. Paint Shop" [class.is-invalid]="p.title" [(ngModel)]="e.title" />
                    @if (p.title) { <small class="invalid" id="sectionNameError">{{ p.title }}</small> }
                  </div>
                  <label class="top" for="sectionHint">What to capture <small class="text-muted fw-normal d-block">(optional, shown in the app)</small></label>
                  <div>
                    <textarea class="form-control" id="sectionHint" rows="2" [maxlength]="limits.hint" placeholder="e.g. Spray booth, drying oven, PPE" [class.is-invalid]="p.hint" [(ngModel)]="e.hint"></textarea>
                    @if (p.hint) { <small class="invalid">{{ p.hint }}</small> }
                  </div>
                  <label for="sectionMin">Minimum photos<span class="req">*</span></label>
                  <div>
                    <input type="number" class="form-control num-input" id="sectionMin" min="0" [max]="limits.photos" step="1" [class.is-invalid]="p.min" [(ngModel)]="e.min" />
                    @if (p.min) { <small class="invalid" id="sectionMinError">{{ p.min }}</small> }
                    @else { <small class="text-muted d-block">0: the section is optional.</small> }
                  </div>
                  <label for="sectionMax">Maximum photos<span class="req">*</span></label>
                  <div>
                    <input type="number" class="form-control num-input" id="sectionMax" min="1" [max]="limits.photos" step="1" [class.is-invalid]="p.max" [(ngModel)]="e.max" />
                    @if (p.max) { <small class="invalid" id="sectionMaxError">{{ p.max }}</small> }
                  </div>
                  @if (levelOptions().length) {
                    <span class="label top">Certification levels</span>
                    <div>
                      <div class="seg" role="group" aria-label="Certification levels">
                        <button type="button" [class.active]="!e.limitLevels" [attr.aria-pressed]="!e.limitLevels" (click)="limit('levels', false)">Every level</button>
                        <button type="button" [class.active]="e.limitLevels" [attr.aria-pressed]="e.limitLevels" (click)="limit('levels', true)">Only these levels</button>
                      </div>
                      @if (e.limitLevels) {
                        <div class="mt-2"><zed-multi-select inputId="sectionLevels" label="Certification levels" [options]="levelOptions()" [(value)]="e.levels" /></div>
                      }
                    </div>
                  }
                  <span class="label top">NIC sectors</span>
                  <div>
                    <div class="seg" role="group" aria-label="NIC sectors">
                      <button type="button" [class.active]="!e.limitSectors" [attr.aria-pressed]="!e.limitSectors" (click)="limit('sectors', false)">Every sector</button>
                      <button type="button" [class.active]="e.limitSectors" [attr.aria-pressed]="e.limitSectors" (click)="limit('sectors', true)">Only these sectors</button>
                    </div>
                    @if (e.limitSectors) {
                      <div class="mt-2"><zed-multi-select inputId="sectionSectors" label="NIC sectors" [options]="sectorOptions()" [(value)]="e.nicSectors" /></div>
                    }
                  </div>
                  <span class="label">In use</span>
                  <div>
                    <div class="form-check m-0">
                      <input class="form-check-input" type="checkbox" id="sectionActive" [(ngModel)]="e.active" />
                      <label class="form-check-label" for="sectionActive">Section is in use</label>
                    </div>
                    @if (p.active) { <small class="invalid">{{ p.active }}</small> }
                    @else if (!e.active) { <small class="text-muted d-block">Not asked in the app; photos already taken are kept.</small> }
                  </div>
                </div>
                <small class="text-muted d-block mt-3">{{ scopeOf(e) }}</small>
              </div>
              @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="editing.set(null)" />
              <input type="button" class="btn btn-primary" value="SAVE" [disabled]="busy()" (click)="save(e)" />
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .sync-note { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: flex-start; color: #5f6f70; font-size: 13px; margin: 0 0 12px; }
    .standard-note { font-weight: 600; color: #23474a; }
    .info-dot {
      flex: 0 0 18px; height: 18px; border-radius: 9px; background: #45a5ad; color: #fff; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; font-style: italic; font-family: Georgia, serif;
    }
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .sections-table { table-layout: fixed; width: 100%; min-width: 760px; margin-bottom: 0; }
    .sections-table td { overflow-wrap: anywhere; vertical-align: top; padding-top: 12px; padding-bottom: 12px; }
    .sections-table tbody tr:hover { background: #f7fbfb; }
    .sections-table tr.is-off td { color: #8a9899; }
    .row-actions .btn { text-transform: none; }
    .order-no {
      display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 14px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 13px;
    }
    .section-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .section-title strong { color: #232527; font-size: 14.5px; }
    .is-off .section-title strong { color: #8a9899; }
    .section-hint { display: block; font-size: 12.5px; margin-top: 2px; color: #3b4b4c; }
    .num { font-weight: 600; font-size: 14px; padding-top: 16px !important; }
    .scope { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 0; }
    .scope .zed-chip { font-size: 11px; padding: 1px 8px; }
    .scope .zed-chip.sector { background: #f1f0fb; color: #3f3a7a; }
    .scope-all { font-size: 11px; color: #5f6f70; border: 1px dashed #cbd9da; border-radius: 10px; padding: 0 8px; margin: 2px 4px 2px 0; }
    .move { display: inline-flex; }
    .move .btn { min-width: 30px; padding: 4px 6px; }
    .move .btn:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
    .move .btn:last-child { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -1px; }
    .totals { color: #3b4b4c; font-size: 13px; font-weight: 600; margin: 10px 0 0; }

    /* The pop-up (as App Forms'). */
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #d9eef0; color: #174a4e; font-size: 13px; font-weight: 600; padding: 6px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #c5e5e8; }
    .seg button.active { background: #23656b; color: #fff; }
    .modal .section-dialog .form-grid { grid-template-columns: 170px minmax(0, 1fr); }
    .section-dialog .form-grid > .label { display: block; text-align: left; white-space: normal; text-transform: none; padding: 0; font-size: 14px;
      font-weight: 600; color: #3b4b4c; background: none; border-radius: 0; }
    .section-dialog .form-grid > .label.top, .form-grid > .top { align-self: start; padding-top: 8px; }
    .modal .section-dialog textarea.form-control { min-height: 64px; height: auto; }
    .num-input { max-width: 120px; }
    .invalid { display: block; color: #a8303a; font-size: 12.5px; margin-top: 3px; }
    @media (max-width: 575.98px) {
      .modal .section-dialog .form-grid { grid-template-columns: minmax(0, 1fr); }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class SiteTourSectionsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/site-tour-sections';

  protected readonly limits = SITE_TOUR_LIMITS;
  protected readonly portals = SITE_TOUR_PORTALS;
  /** The app whose site tour the chosen portal's sections are. */
  private readonly adminPortal = inject(AdminPortalService);
  protected readonly appName = computed(() =>
    this.adminPortal.effective(SITE_TOUR_PORTALS) === 'consultancy' ? 'consultant app (milestone 1 visit)' : 'site assessor app');
  protected readonly data = signal<SiteTourSectionsResponse | null>(null);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');

  /** The levels and NIC sectors a section can be limited to. */
  protected readonly levelOptions = computed<MultiSelectOption[]>(() => (this.data()?.levels ?? []).map((l) => ({ value: l.code, label: l.name })));
  protected readonly sectorOptions = signal<MultiSelectOption[]>([]);

  /** "10 sections · up to 30 photos in total" (the photos of the sections in use). */
  protected readonly totals = computed(() => {
    const sections = this.data()?.sections ?? [];
    const off = sections.filter((s) => !s.active).length;
    const photos = sections.filter((s) => s.active).reduce((sum, s) => sum + s.max, 0);
    return `${sections.length} ${sections.length === 1 ? 'section' : 'sections'}` + (off ? ` (${off} off)` : '') + ` · up to ${photos} photos in total`;
  });

  /** Save was pressed in the pop-up: an empty name is reported too. */
  private readonly tried = signal(false);

  constructor() {
    void this.load();
    firstValueFrom(this.http.get<{ code: string; name: string }[]>('/api/staff/masters/sectors'))
      .then((list) => this.sectorOptions.set(list.map((x) => ({ value: x.code, label: `${x.code} - ${x.name}` }))))
      .catch(() => undefined);
  }

  protected levelName(code: string): string {
    return this.data()?.levels.find((l) => l.code.toLowerCase() === code.toLowerCase())?.name ?? code;
  }

  protected scopeText(s: SiteTourSection): string {
    const levels = s.levels.length ? s.levels.map((l) => this.levelName(l)).join(', ') : 'All levels';
    const sectors = s.nicSectors.length ? `NIC ${s.nicSectors.join(', ')}` : 'All sectors';
    return `${levels} · ${sectors}`;
  }

  /** The pop-up's line under the form: who is asked the section. */
  protected scopeOf(e: Editing): string {
    const levels = e.levels.length ? e.levels.map((l) => this.levelName(l)).join(', ') : 'every level';
    const sectors = e.nicSectors.length ? `NIC sectors ${e.nicSectors.join(', ')}` : 'units of every sector';
    return `Asked for ${levels}, of ${sectors}.`;
  }

  protected add(): void {
    this.modalError.set('');
    this.editing.set({ section: null, title: '', hint: '', min: 1, max: 3, levels: [], nicSectors: [], active: true, limitLevels: false, limitSectors: false });
    this.tried.set(false);
  }

  protected edit(s: SiteTourSection): void {
    this.modalError.set('');
    this.editing.set({
      section: s, title: s.title, hint: s.hint ?? '', min: s.min, max: s.max, levels: [...s.levels], nicSectors: [...s.nicSectors], active: s.active,
      limitLevels: s.levels.length > 0, limitSectors: s.nicSectors.length > 0,
    });
    this.tried.set(false);
  }

  /** "Every level / sector" (the list emptied) or "Only these" (the list to choose from). */
  protected limit(what: 'levels' | 'sectors', on: boolean): void {
    const now = this.editing();
    if (!now) return;
    const next = { ...now };
    if (what === 'levels') {
      next.limitLevels = on;
      if (!on) next.levels = [];
    } else {
      next.limitSectors = on;
      if (!on) next.nicSectors = [];
    }
    this.editing.set(next);
  }

  protected async save(e: Editing): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.tried.set(true);
    if (Object.keys(this.check(e)).length) return;
    const section: SiteTourSection = {
      id: e.section?.id ?? sectionId(e.title.trim(), d.sections.map((s) => s.id)),
      title: e.title.trim(),
      hint: e.hint.trim() || null,
      min: e.min!,
      max: e.max!,
      levels: [...e.levels],
      nicSectors: [...e.nicSectors],
      active: e.active,
    };
    const sections = e.section ? d.sections.map((s) => (s.id === e.section!.id ? section : s)) : [...d.sections, section];
    this.busy.set(true);
    this.modalError.set('');
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(SiteTourSectionsPage.url, { sections }));
      this.editing.set(null);
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected move(index: number, by: -1 | 1): Promise<void> {
    const sections = [...(this.data()?.sections ?? [])];
    const target = index + by;
    if (target < 0 || target >= sections.length) return Promise.resolve();
    [sections[index], sections[target]] = [sections[target], sections[index]];
    return this.change(() => this.http.put<MessageResponse>(SiteTourSectionsPage.url, { sections }));
  }

  protected resetAll(): Promise<void> {
    if (!confirm('Go back to the ten standard site tour sections? The sections added or changed here are removed.')) return Promise.resolve();
    return this.change(() => this.http.delete<MessageResponse>(SiteTourSectionsPage.url));
  }

  /**
   * The server's rules (SiteTourSections.Problem) for the section being edited, by field; called by the template, as the
   * pop-up's fields are plain properties bound with ngModel.
   */
  protected check(e: Editing): SectionProblems {
    const p: SectionProblems = {};
    const title = e.title.trim();
    const others = (this.data()?.sections ?? []).filter((s) => s.id !== e.section?.id);
    if (!title) {
      if (this.tried()) p.title = 'Enter the section name.';
    } else if (title.length > SITE_TOUR_LIMITS.title) {
      p.title = `At most ${SITE_TOUR_LIMITS.title} characters.`;
    } else if (/^[0-9]/.test(title)) {
      p.title = 'The name cannot start with a number.';
    } else if (title.includes(' - ')) {
      p.title = 'The name cannot contain " - " (a space, a dash and a space).';
    } else if (others.some((s) => s.title.trim().toLowerCase() === title.toLowerCase())) {
      p.title = 'Another section has this name.';
    }
    if (e.hint.trim().length > SITE_TOUR_LIMITS.hint) p.hint = `At most ${SITE_TOUR_LIMITS.hint} characters.`;
    const max = e.max;
    const min = e.min;
    if (max === null || max === undefined || !Number.isInteger(max) || max < 1 || max > SITE_TOUR_LIMITS.photos) {
      p.max = `Enter a whole number from 1 to ${SITE_TOUR_LIMITS.photos}.`;
    }
    if (min === null || min === undefined || !Number.isInteger(min) || min < 0) {
      p.min = 'Enter a whole number, 0 or more.';
    } else if (!p.max && min > max!) {
      p.min = 'The minimum cannot be more than the maximum.';
    }
    if (!e.active && !others.some((s) => s.active)) p.active = 'At least one section must be in use.';
    return p;
  }

  private async change(request: () => Observable<MessageResponse>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(request());
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      this.data.set(await firstValueFrom(this.http.get<SiteTourSectionsResponse>(SiteTourSectionsPage.url)));
    } catch (err) {
      this.data.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
