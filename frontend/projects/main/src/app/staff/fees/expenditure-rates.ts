import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import {
  ExpenditureApi, PayeeKind, RateHistoryEntry, RateSet, RatesResponse, SetLevel, dmy, rupees,
} from '../expenditure/expenditure.api';
import { staffCrumbs } from '../staff-crumbs';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import { indianTime } from '../utc-time';

/** A card's editor: the set chosen (or a new one) and its rates as typed. */
interface Editor {
  /** The chosen set's date of effect, or '' for a new set. */
  pick: string;
  effectiveFrom: string;
  gst: number | null;
  levels: SetLevel[];
}

const NEW = '';

/**
 * 2026-11-18 (approved design "Expenditure monitoring", section 1; the user: "with date of effect"): Admin → Fees →
 * Expenditure rates. What an assessment agency is paid per case (completed, rejected after assessment, surveillance visit) and a
 * consultant organisation per counted handholding milestone (as many columns as the level has milestones), before GST. Each
 * rate set has a date of effect (future dates allowed); a case keeps the rate of the set in force on the day it counted. A set
 * becomes read-only once an approved invoice includes a case priced with it. "Rate history" lists every save.
 */
@Component({
  selector: 'zed-staff-expenditure-rates',
  imports: [FormsModule, PageHead],
  styleUrl: '../expenditure/exp-dialog.scss',
  styles: `
    .xr-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 16px; }
    .xr-card { padding: 0; overflow: hidden; }
    .xr-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid #dde7e8; }
    .xr-head h3 { margin: 0; font-size: 16px; font-weight: 700; color: #17373b; }
    .xr-head .xr-from { margin-left: auto; display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: #6f8487; }
    .xr-head .form-select, .xr-head .form-control { width: auto; height: 36px; }
    .xr-card table { margin: 0; }
    .xr-card input.form-control { width: 120px; margin-left: auto; text-align: right; height: 34px; }
    .xr-na { color: #9aa9ab; font-size: 12px; }
    .xr-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid #dde7e8; font-size: 12.5px; color: #6f8487; }
    .xr-foot .btn { margin-left: auto; }
    .xr-gst { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 13px; }
    .xr-gst input { width: 90px; }
    @media (max-width: 575.98px) { .xr-two { grid-template-columns: 1fr; } }
  `,
  template: `
    <zed-page-head [crumbs]="crumbs" title="Expenditure rates"
                   subtitle="Amount paid per case to the assessment agency and the consultant organisation, before GST. A case keeps the rate in force on the day it counted.">
      <button type="button" class="btn btn-default" (click)="openHistory()">Rate history</button>
    </zed-page-head>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    @if (data(); as d) {
      <div class="xr-two">
        @for (kind of kinds; track kind) {
          @let e = editor(kind);
          @let set = chosen(kind);
          @let locked = !!set?.locked;
          <div class="zed-card xr-card">
            <div class="xr-head">
              <span class="xd-ico" aria-hidden="true">{{ kind === 'Agency' ? 'A' : 'C' }}</span>
              <h3>{{ kind === 'Agency' ? 'Assessment agency · per case' : 'Consultant organisation · per milestone' }}</h3>
              <div class="xr-from">
                <span>Date of effect</span>
                <select class="form-select" [attr.aria-label]="kind + ' rate set'" [ngModel]="e.pick" (ngModelChange)="choose(kind, $event)">
                  @for (s of setsOf(kind); track s.effectiveFrom) {
                    <option [value]="s.effectiveFrom">{{ dmy(s.effectiveFrom) }}{{ s.inForce ? ' (in force)' : s.effectiveFrom > d.today ? ' (future)' : '' }}{{ s.locked ? ' · read-only' : '' }}</option>
                  }
                  <option [value]="''">+ New rate set</option>
                </select>
                @if (e.pick === '') { <input type="date" class="form-control" [attr.aria-label]="kind + ' date of effect'" [(ngModel)]="e.effectiveFrom" /> }
              </div>
            </div>
            <div class="table-responsive">
              <table class="table table-zed">
                @if (kind === 'Agency') {
                  <thead><tr><th>Level</th><th>Assessment flow (Admin)</th><th class="num">Completed</th><th class="num">Rejected after assessment</th><th class="num">Surveillance visit</th></tr></thead>
                  <tbody>
                    @for (l of d.agencyLevels; track l.level; let i = $index) {
                      <tr><td>{{ l.name }}</td><td><small>{{ l.flow }}</small></td>
                        <td class="num"><input type="number" min="0" class="form-control" [disabled]="locked" [attr.aria-label]="l.name + ' completed'" [(ngModel)]="e.levels[i].completed" /></td>
                        <td class="num"><input type="number" min="0" class="form-control" [disabled]="locked" [attr.aria-label]="l.name + ' rejected'" [(ngModel)]="e.levels[i].rejected" /></td>
                        <td class="num"><input type="number" min="0" class="form-control" [disabled]="locked" [attr.aria-label]="l.name + ' surveillance'" [(ngModel)]="e.levels[i].surveillance" /></td></tr>
                    }
                  </tbody>
                } @else {
                  <thead><tr><th>Level</th><th>Milestones</th>@for (m of milestoneColumns(); track m) { <th class="num">Milestone {{ m }}</th> }</tr></thead>
                  <tbody>
                    @for (l of d.consultantLevels; track l.level; let i = $index) {
                      <tr><td>{{ l.name }}</td><td>{{ l.milestones }}</td>
                        @for (m of milestoneColumns(); track m) {
                          <td class="num">@if (m <= l.milestones) {
                              <input type="number" min="0" class="form-control" [disabled]="locked" [attr.aria-label]="l.name + ' milestone ' + m" [(ngModel)]="e.levels[i].milestones[m - 1]" />
                            } @else { <span class="xr-na">not used</span> }</td>
                        }
                      </tr>
                    }
                  </tbody>
                }
              </table>
            </div>
            <div class="xr-foot">
              @if (locked) { <span>Read-only: an approved invoice includes cases priced with this set. Add a new rate set to change the rates from a later date.</span> }
              @else if (kind === 'Agency') { <span>A case counts when the last assessment step of the level's flow is done; "rejected after assessment" only after that step.</span> }
              @else { <span>The columns follow the level's handholding milestones. A milestone counts when the MSME pays the next milestone; the last milestone counts when the unit is certified at the level.</span> }
              @if (set?.savedBy) { <span>Saved by {{ set!.savedBy }}, {{ date(set!.savedOn) }}</span> }
              <button type="button" class="btn btn-primary" [disabled]="locked || busy()" (click)="save(kind)">{{ e.pick === '' ? 'Add rate set' : 'Save rates' }}</button>
            </div>
          </div>
        }
      </div>
      <div class="xr-gst"><label for="xr-gst">GST % added on invoices</label>
        <input id="xr-gst" type="number" min="0" max="100" step="0.01" class="form-control" [(ngModel)]="gst" /></div>
    } @else if (!error()) {
      <p role="status">Loading…</p>
    }

    @if (history(); as h) {
      <div class="xd-back" (click)="history.set(null)"></div>
      <div class="xd wide" role="dialog" aria-modal="true" aria-labelledby="rh-title">
        <div class="xd-head"><span class="xd-ico" aria-hidden="true">⟲</span><div><h3 id="rh-title">Rate history</h3><small>Every save of every rate set</small></div>
          <button type="button" class="xd-x" aria-label="Close" (click)="history.set(null)">×</button></div>
        <div class="xd-body">
          <table class="table table-zed">
            <thead><tr><th>Payee</th><th>Date of effect</th><th>Rates</th><th class="num">GST</th><th>Saved by</th><th>Saved on</th></tr></thead>
            <tbody>
              @for (r of h; track $index) {
                <tr><td>{{ r.kind === 'Agency' ? 'Assessment agency' : 'Consultant organisation' }}</td><td>{{ dmy(r.effectiveFrom) }}@if (!r.current) { <small>replaced</small> }</td>
                  <td><small>{{ ratesText(r) }}</small></td><td class="num">{{ r.gstPercent }}%</td><td>{{ r.savedBy || '—' }}</td><td>{{ date(r.savedOn) }}</td></tr>
              } @empty { <tr><td colspan="6"><div class="no-data">No rates saved yet.</div></td></tr> }
            </tbody>
          </table>
        </div>
        <div class="xd-foot">
          <button type="button" class="btn btn-outline-primary" [disabled]="!h.length" (click)="exportHistory(h)">Export</button>
          <button type="button" class="btn btn-default" (click)="history.set(null)">Close</button>
        </div>
      </div>
    }
  `,
})
export class ExpenditureRatesPage {
  private readonly api = inject(ExpenditureApi);
  private readonly excel = inject(TableExport);
  private readonly toast = inject(ToastService);

  protected readonly crumbs = staffCrumbs({ label: 'Fees', link: '/staff/fees' }, { label: 'Expenditure rates' });
  protected readonly kinds: PayeeKind[] = ['Agency', 'Consultant'];
  protected readonly data = signal<RatesResponse | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly history = signal<RateHistoryEntry[] | null>(null);
  private readonly editors = signal<Record<PayeeKind, Editor> | null>(null);
  protected gst: number | null = 18;
  protected readonly dmy = dmy;
  /** When a set was saved (stored in UTC): its day in India (2026-11-19 admin audit: the UTC day was shown). */
  protected readonly date = (v: string | null | undefined): string => indianTime(v, 'dd MMM yyyy') || '—';

  /** The most milestones any level has (the columns; a level with fewer shows "not used"). */
  protected readonly milestoneColumns = computed(() => {
    const n = Math.max(1, ...(this.data()?.consultantLevels ?? []).map((l) => l.milestones));
    return Array.from({ length: n }, (_, i) => i + 1);
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const d = await firstValueFrom(this.api.rates());
      this.data.set(d);
      this.gst = d.gstPercent;
      const initial = (kind: PayeeKind): Editor => {
        const sets = this.setsOf(kind);
        const s = sets.find((x) => x.inForce) ?? sets[0];
        return this.editorFor(kind, s);
      };
      this.editors.set({ Agency: initial('Agency'), Consultant: initial('Consultant') });
      this.error.set('');
    } catch (e) {
      this.error.set(apiErrorMessage(e));
    }
  }

  /** A payee type's sets, newest date of effect first. */
  protected setsOf(kind: PayeeKind): RateSet[] {
    return (this.data()?.sets ?? []).filter((s) => s.kind === kind).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  }

  protected editor(kind: PayeeKind): Editor {
    return this.editors()![kind];
  }

  protected chosen(kind: PayeeKind): RateSet | null {
    const pick = this.editors()?.[kind].pick;
    return pick ? (this.setsOf(kind).find((s) => s.effectiveFrom === pick) ?? null) : null;
  }

  protected choose(kind: PayeeKind, pick: string): void {
    const s = pick === NEW ? undefined : this.setsOf(kind).find((x) => x.effectiveFrom === pick);
    const base = s ?? this.setsOf(kind).find((x) => x.inForce) ?? this.setsOf(kind)[0];
    const e = this.editorFor(kind, base);
    if (!s) {
      e.pick = NEW;
      e.effectiveFrom = '';
    } else this.gst = s.gstPercent;
    this.editors.update((all) => ({ ...all!, [kind]: e }));
  }

  /** The editor of a set (its rates copied; levels the set lacks start empty). */
  private editorFor(kind: PayeeKind, s: RateSet | undefined): Editor {
    const d = this.data()!;
    const codes = kind === 'Agency' ? d.agencyLevels.map((l) => l.level) : d.consultantLevels.map((l) => l.level);
    return {
      pick: s?.effectiveFrom ?? NEW,
      effectiveFrom: s?.effectiveFrom ?? '',
      gst: s?.gstPercent ?? d.gstPercent,
      levels: codes.map((level) => {
        const r = s?.levels.find((x) => x.level === level);
        return { level, completed: r?.completed ?? null, rejected: r?.rejected ?? null, surveillance: r?.surveillance ?? null, milestones: [0, 1, 2].map((i) => r?.milestones[i] ?? null) };
      }),
    };
  }

  protected async save(kind: PayeeKind): Promise<void> {
    const e = this.editor(kind);
    const d = this.data()!;
    const counts = new Map(d.consultantLevels.map((l) => [l.level, l.milestones]));
    const num = (v: number | null | string) => (v === null || v === '' ? null : Number(v));
    this.busy.set(true);
    try {
      const r = await firstValueFrom(this.api.saveRates({
        kind,
        effectiveFrom: e.effectiveFrom,
        edit: e.pick !== NEW,
        gstPercent: num(this.gst),
        levels: e.levels.map((l) => kind === 'Agency'
          ? { level: l.level, completed: num(l.completed), rejected: num(l.rejected), surveillance: num(l.surveillance) }
          : { level: l.level, milestones: l.milestones.slice(0, counts.get(l.level) ?? 3).map(num) }),
      }));
      this.toast.success(r.message);
      await this.load();
    } catch (err) {
      this.toast.error('Rates not saved', apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async openHistory(): Promise<void> {
    try {
      this.history.set(await firstValueFrom(this.api.rateHistory()));
    } catch (e) {
      this.toast.error('Rate history could not be loaded', apiErrorMessage(e));
    }
  }

  protected ratesText(r: RateHistoryEntry): string {
    return r.levels.map((l) => r.kind === 'Agency'
      ? `${l.level}: ${rupees(l.completed)} / ${rupees(l.rejected)} / ${rupees(l.surveillance)}`
      : `${l.level}: ${l.milestones.map((m) => rupees(m)).join(' / ')}`).join(' · ');
  }

  protected async exportHistory(h: RateHistoryEntry[]): Promise<void> {
    const rows = h.flatMap((r) => r.levels.map((l) => [r.kind === 'Agency' ? 'Assessment agency' : 'Consultant organisation', r.effectiveFrom, l.level,
      l.completed, l.rejected, l.surveillance, l.milestones[0] ?? null, l.milestones[1] ?? null, l.milestones[2] ?? null, r.gstPercent, r.savedBy, indianTime(r.savedOn),
      r.current ? 'Current' : 'Replaced']));
    try {
      await this.excel.xlsx('expenditure-rate-history', [{
        name: 'Rate history',
        columns: ['Payee', 'Date of effect', 'Level', 'Completed', 'Rejected after assessment', 'Surveillance visit', 'Milestone 1', 'Milestone 2', 'Milestone 3',
          'GST %', 'Saved by', 'Saved on', 'State'],
        rows,
      }]);
    } catch (e) {
      this.toast.error('Export failed', apiErrorMessage(e));
    }
  }
}
