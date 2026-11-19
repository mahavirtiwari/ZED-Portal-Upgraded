import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ALL_PORTALS, AdminPortal, PortalSwitchComponent } from '../admin-portal';
import { PageHead } from '../../msme/shared/page-head';
import { ChipFilter, FilterChip } from '../chip-filter';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';

export const TAT_API = '/api/staff/settings/tat';

export interface TatStatus { code: string; name: string; track: string | null; final: boolean; systemText: string | null }
export interface TatPoint { code: string; name: string; kind: 'status' | 'milestone'; track: string | null }
export interface TatRelation { id: number; name: string; certification: string | null; fromStatus: string; toStatus: string; days: number; isActive: boolean; sortOrder: number }
export interface TatSuggestion { name: string; fromStatus: string; toStatus: string; days: number; added: boolean }

/** GET api/staff/settings/tat (Zed.Portal TatController). */
export interface TatResponse {
  module: string;
  levels: { code: string; name: string }[];
  statuses: TatStatus[];
  points: TatPoint[];
  /** level → status → days. */
  days: Record<string, Record<string, number>>;
  relations: TatRelation[];
  suggestions: TatSuggestion[];
}

/** The switch's names for the modules each portal's TAT is for. */
export const TAT_MODULES: Partial<Record<AdminPortal, string>> = { main: 'Assessment', consultancy: 'Handholding', surveillance: 'Surveillance' };

interface Editing { id: number | null; name: string; certification: string; fromStatus: string; toStatus: string; days: number | null; isActive: boolean }

type Ask = { kind: 'delete'; relation: TatRelation } | { kind: 'suggested' };

/**
 * Administration → TAT (Turnaround Time), 2026-11-18 (the user's decisions "TAT and monitoring"): for the module of the
 * portal chosen on the switch (Assessment, Handholding, Surveillance), the days a case may stay in each status, per
 * certification level (blank = no TAT), and the relations "from → to in N days" the Admin names (per level or all levels).
 * The monitoring pages decide from these which case is delayed. "Add suggested relations" adds the examples on a click only.
 */
@Component({
  selector: 'zed-staff-tat',
  imports: [FormsModule, PortalSwitchComponent, PageHead, ChipFilter, ConfirmDialog],
  template: `
    <zed-page-head title="TAT (Turnaround Time)" [crumbs]="[{ label: 'All settings', link: '/staff/administration' }, { label: 'TAT' }]"
      subtitle="Days allowed per status and between statuses; the monitoring pages show the delayed cases from these." />
    <zed-portal-switch [portals]="portals" title="Module" [labels]="modules" />
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    @if (data(); as d) {
      <div class="zed-card tat-card">
        <div class="tat-head">
          <h3 class="tat-h">Days allowed per status · {{ d.module }}</h3>
          <zed-chip-filter label="Level" [chips]="levelChips()" [value]="level()" (valueChange)="pickLevel($event)" />
        </div>
        <div class="table-responsive">
          <table class="table table-zed tat-table">
            <thead><tr><th>Status</th><th>Stage</th><th class="tat-days">Days allowed</th></tr></thead>
            <tbody>
              @for (s of d.statuses; track s.code) {
                <tr [attr.data-status]="s.code" [class.is-off]="s.final">
                  <td><b>{{ s.name }}</b>@if (s.systemText && s.systemText.toLowerCase() !== s.name.toLowerCase()) { <small class="sub">{{ s.systemText }}</small> }</td>
                  <td>@if (s.track) { <span class="chip is-info">{{ s.track === 'desktop' ? 'Desktop' : 'Site' }}</span> }</td>
                  <td class="tat-days">
                    @if (s.final) { <span class="text-muted">Final status</span> }
                    @else {
                      <input type="number" class="form-control" min="1" max="365" placeholder="No TAT" [attr.aria-label]="'Days allowed: ' + s.name"
                        [ngModel]="draft()[s.code] ?? null" (ngModelChange)="setDays(s.code, $event)" />
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="tat-foot">
          <small class="text-muted">Blank = no TAT for that status. Days count from the date the case reached the status.</small>
          <button type="button" class="btn btn-primary" [disabled]="!dirty() || busy()" (click)="saveDays()">Save days</button>
        </div>
      </div>

      <div class="zed-card tat-card">
        <div class="tat-head">
          <h3 class="tat-h">Relations</h3>
          <div class="tat-acts">
            <button type="button" class="btn btn-default" [disabled]="!missing().length || busy()" (click)="ask.set({ kind: 'suggested' })">Add Suggested Relations</button>
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="add()">Add Relation</button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-zed tat-table">
            <thead><tr><th>Name</th><th>Level</th><th>From → To</th><th class="text-end">Days</th><th class="text-end">Actions</th></tr></thead>
            <tbody>
              @for (r of d.relations; track r.id) {
                <tr [attr.data-id]="r.id" [class.is-off]="!r.isActive">
                  <td><b>{{ r.name }}</b>@if (!r.isActive) { <span class="status-badge is-inactive ms-1">Inactive</span> }</td>
                  <td>{{ levelLabel(r.certification) }}</td>
                  <td>{{ pointName(r.fromStatus) }} → {{ pointName(r.toStatus) }}</td>
                  <td class="text-end">{{ r.days }}</td>
                  <td class="text-end text-nowrap">
                    <button type="button" class="btn btn-sm" [class.btn-outline-danger]="r.isActive" [class.btn-outline-primary]="!r.isActive" [disabled]="busy()" (click)="toggle(r)">{{ r.isActive ? 'Deactivate' : 'Activate' }}</button>
                    <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="busy()" (click)="edit(r)">Edit</button>
                    <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" (click)="ask.set({ kind: 'delete', relation: r })">Delete</button>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5"><div class="no-data">No relations yet. Add one, or add the suggested relations.</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    } @else if (!busy()) {
      <div class="no-data">The TAT could not be loaded</div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="tatRelTitle">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h3 class="registration-title m-0" id="tatRelTitle">{{ e.id ? 'Edit Relation' : 'Add Relation' }}</h3></div>
            <div class="modal-body">
              <label class="form-label" for="tatName">Name<span class="req">*</span></label>
              <input id="tatName" class="form-control" maxlength="100" placeholder="e.g. Allocation to desktop assessment" [(ngModel)]="e.name" />
              <label class="form-label mt-3" for="tatLevel">Level</label>
              <select id="tatLevel" class="form-select" [(ngModel)]="e.certification">
                <option value="">All levels</option>
                @for (l of data()?.levels ?? []; track l.code) { <option [value]="l.code">{{ l.name }}</option> }
              </select>
              <label class="form-label mt-3" for="tatFrom">From<span class="req">*</span></label>
              <select id="tatFrom" class="form-select" [(ngModel)]="e.fromStatus">
                <option value="">Choose</option>
                @for (p of startPoints(); track p.code) { <option [value]="p.code">{{ p.name }}</option> }
              </select>
              <label class="form-label mt-3" for="tatTo">To<span class="req">*</span></label>
              <select id="tatTo" class="form-select" [(ngModel)]="e.toStatus">
                <option value="">Choose</option>
                @for (p of data()?.points ?? []; track p.code) { <option [value]="p.code">{{ p.name }}</option> }
              </select>
              <label class="form-label mt-3" for="tatDays">Days<span class="req">*</span></label>
              <input id="tatDays" type="number" class="form-control" min="1" max="999" [(ngModel)]="e.days" />
              <div class="form-check mt-3">
                <input class="form-check-input" type="checkbox" id="tatActive" [(ngModel)]="e.isActive" />
                <label class="form-check-label" for="tatActive">Active</label>
              </div>
              @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="editing.set(null)">Cancel</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="save(e)">Save</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (ask(); as a) {
      <zed-confirm-dialog [ask]="confirmAsk(a)" [busy]="busy()" [failed]="modalError()" (confirmed)="confirm(a)" (cancel)="closeAsk()" />
    }
    @if (busy()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .tat-card { padding: 16px 18px; margin-bottom: 18px; }
    .tat-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    .tat-h { margin: 0; font-size: 17px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .tat-acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .tat-table { margin-bottom: 0; }
    .tat-table td { vertical-align: middle; overflow-wrap: break-word; }
    .tat-table .status-badge { white-space: nowrap; }
    .tat-table tr.is-off td { color: #8a9899; }
    .tat-table .sub { display: block; color: #6f8487; font-size: 11.5px; }
    .tat-days { width: 170px; }
    .tat-days input { max-width: 140px; }
    .tat-table .btn-sm { margin-left: 6px; }
    .tat-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
  `,
})
export class TatPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly portals = ALL_PORTALS;
  protected readonly modules = TAT_MODULES;

  protected readonly data = signal<TatResponse | null>(null);
  protected readonly level = signal('');
  /** The chosen level's days as edited (status → days). */
  protected readonly draft = signal<Record<string, number | null>>({});
  protected readonly dirty = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly modalError = signal('');
  protected readonly editing = signal<Editing | null>(null);
  protected readonly ask = signal<Ask | null>(null);

  protected readonly levelChips = computed<FilterChip[]>(() => {
    const d = this.data();
    return (d?.levels ?? []).map((l) => ({ key: l.code, label: l.name, count: Object.keys(d?.days[l.code] ?? {}).length || null }));
  });
  protected readonly missing = computed(() => (this.data()?.suggestions ?? []).filter((s) => !s.added));
  /** A relation cannot start from a final status. */
  protected readonly startPoints = computed(() => {
    const finals = new Set((this.data()?.statuses ?? []).filter((s) => s.final).map((s) => s.code));
    return (this.data()?.points ?? []).filter((p) => !finals.has(p.code));
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const d = await firstValueFrom(this.http.get<TatResponse>(TAT_API));
      this.data.set(d);
      if (!d.levels.some((l) => l.code === this.level())) this.level.set(d.levels[0]?.code ?? '');
      this.resetDraft();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private resetDraft(): void {
    this.draft.set({ ...(this.data()?.days[this.level()] ?? {}) });
    this.dirty.set(false);
  }

  protected pickLevel(code: string): void {
    this.level.set(code);
    this.resetDraft();
  }

  protected setDays(code: string, value: unknown): void {
    const n = value === null || value === '' || value === undefined ? null : Number(value);
    this.draft.update((d) => ({ ...d, [code]: n }));
    this.dirty.set(true);
  }

  protected async saveDays(): Promise<void> {
    const d = this.data();
    if (!d) return;
    const draft = this.draft();
    const bad = d.statuses.find((s) => !s.final && draft[s.code] !== null && draft[s.code] !== undefined && !(Number.isInteger(draft[s.code]) && draft[s.code]! >= 1 && draft[s.code]! <= 365));
    if (bad) {
      this.toast.error('Days allowed', `${bad.name}: enter 1 to 365 days, or leave it blank.`);
      return;
    }
    const days = d.statuses.filter((s) => !s.final).map((s) => ({ status: s.code, days: draft[s.code] ?? null }));
    await this.run(this.http.put<MessageResponse>(`${TAT_API}/days/${encodeURIComponent(this.level())}`, { days }), 'TAT');
  }

  protected add(): void {
    this.modalError.set('');
    this.editing.set({ id: null, name: '', certification: '', fromStatus: '', toStatus: '', days: null, isActive: true });
  }

  protected edit(r: TatRelation): void {
    this.modalError.set('');
    this.editing.set({ id: r.id, name: r.name, certification: r.certification ?? '', fromStatus: r.fromStatus, toStatus: r.toStatus, days: r.days, isActive: r.isActive });
  }

  /** Null when the relation can be sent; else what to fix (the API checks again). */
  static problem(e: Editing): string | null {
    if (!e.name.trim()) return "Please enter the relation's name.";
    if (!e.fromStatus) return 'Please choose the status the relation starts from.';
    if (!e.toStatus) return 'Please choose the status the relation ends at.';
    if (e.fromStatus === e.toStatus) return 'The relation must end at another status.';
    if (!(Number.isInteger(Number(e.days)) && Number(e.days) >= 1 && Number(e.days) <= 999)) return 'Days must be 1 to 999.';
    return null;
  }

  protected async save(e: Editing): Promise<void> {
    const p = TatPage.problem(e);
    if (p) {
      this.modalError.set(p);
      return;
    }
    const body = { name: e.name.trim(), certification: e.certification || null, fromStatus: e.fromStatus, toStatus: e.toStatus, days: Number(e.days), isActive: e.isActive };
    const call = e.id ? this.http.put<MessageResponse>(`${TAT_API}/relations/${e.id}`, body) : this.http.post<MessageResponse>(`${TAT_API}/relations`, body);
    if (await this.run(call, 'Relation', true)) this.editing.set(null);
  }

  protected async toggle(r: TatRelation): Promise<void> {
    const body = { name: r.name, certification: r.certification, fromStatus: r.fromStatus, toStatus: r.toStatus, days: r.days, isActive: !r.isActive };
    await this.run(this.http.put<MessageResponse>(`${TAT_API}/relations/${r.id}`, body), 'Relation');
  }

  protected confirmAsk(a: Ask): ConfirmAsk {
    if (a.kind === 'delete') {
      return { title: 'Delete Relation', message: `Delete "${a.relation.name}"? The monitoring pages stop using it.`, confirmLabel: 'Delete', danger: true };
    }
    return {
      title: 'Add Suggested Relations', confirmLabel: 'Add', icon: 'info',
      message: 'These relations will be added for all levels (you can change or delete them afterwards):',
      points: this.missing().map((s) => `${s.name}: ${this.pointName(s.fromStatus)} → ${this.pointName(s.toStatus)}, ${s.days} days`),
    };
  }

  protected closeAsk(): void {
    this.ask.set(null);
    this.modalError.set('');
  }

  protected async confirm(a: Ask): Promise<void> {
    const call = a.kind === 'delete'
      ? this.http.delete<MessageResponse>(`${TAT_API}/relations/${a.relation.id}`)
      : this.http.post<MessageResponse>(`${TAT_API}/relations/suggested`, null);
    if (await this.run(call, 'Relations', true)) this.ask.set(null);
  }

  private async run(call: Observable<MessageResponse>, title: string, inModal = false): Promise<boolean> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      const res = await firstValueFrom(call);
      this.toast.success(title, res?.message);
    } catch (err) {
      if (inModal) this.modalError.set(apiErrorMessage(err));
      else this.toast.error(title, apiErrorMessage(err));
      this.busy.set(false);
      return false;
    }
    this.busy.set(false);
    await this.load();
    return true;
  }

  protected pointName(code: string): string {
    return this.data()?.points.find((p) => p.code === code)?.name ?? code;
  }

  protected levelLabel(code: string | null): string {
    return code ? (this.data()?.levels.find((l) => l.code === code)?.name ?? code) : 'All levels';
  }
}
