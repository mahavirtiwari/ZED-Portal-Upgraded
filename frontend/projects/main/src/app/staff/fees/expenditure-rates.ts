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
import { TextPipe, t } from '../../content/page-text';
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
  imports: [FormsModule, PageHead, TextPipe],
  styleUrl: '../expenditure/exp-dialog.scss',
  styles: `
    .xr-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 16px; }
    .xr-card { padding: 0; overflow: hidden; }
    .xr-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid #dde7e8; }
    .xr-head h3 { margin: 0; font-size: 16px; font-weight: 700; color: #17373b; }
    /* The "Date of effect" picker on its own line in both cards, so the two tables start level. */
    .xr-head h3 { flex: 1 1 0; min-width: 0; }
    .xr-head .xr-from { flex: 1 0 100%; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12.5px; color: #6f8487; }
    .xr-head .form-select, .xr-head .form-control { width: auto; height: 36px; }
    .xr-card table { margin: 0; table-layout: fixed; min-width: 560px; }
    .xr-c-level { width: 116px; }
    .xr-c-flow { width: 136px; }
    .xr-c-count { width: 96px; }
    .xr-level, .xr-flow { white-space: nowrap; }
    .xr-card th { white-space: normal; overflow-wrap: normal; vertical-align: bottom; }
    .xr-card input.form-control { width: 100%; max-width: 120px; margin-left: auto; text-align: right; height: 34px; }
    .xr-na { color: #9aa9ab; font-size: 12px; }
    .xr-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid #dde7e8; font-size: 12.5px; color: #6f8487; }
    .xr-foot .btn { margin-left: auto; }
    .xr-gst { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 13px; }
    .xr-gst input { width: 90px; }
    .rh-table td { vertical-align: top; }
    .rh-c-payee { width: 170px; } .rh-c-date { width: 150px; } .rh-c-gst { width: 64px; } .rh-c-by { width: 120px; } .rh-c-on { width: 110px; }
    .rh-replaced { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; background: #eef1f1; color: #5f6f70; font-size: 11px; }
    .rh-line { display: block; white-space: nowrap; }
    @media (max-width: 575.98px) { .xr-two { grid-template-columns: 1fr; } }
  `,
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="'Expenditure rates' | t: 'staff.expenditureRates.title'"
                   [subtitle]="'Amount paid per case to the assessment agency and the consultant organisation, before GST. A case keeps the rate in force on the day it counted.' | t: 'staff.expenditureRates.subtitle'">
      <button type="button" class="btn btn-outline-primary" (click)="openHistory()">{{ 'Rate history' | t: 'staff.expenditureRates.historyButton' }}</button>
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
              <h3>{{ kind === 'Agency' ? ('Assessment agency · per case' | t: 'staff.expenditureRates.agency.title') : ('Consultant organisation · per milestone' | t: 'staff.expenditureRates.consultant.title') }}</h3>
              <div class="xr-from">
                <span>{{ 'Date of effect' | t: 'staff.expenditureRates.dateOfEffect.label' }}</span>
                <select class="form-select" [attr.aria-label]="'{kind} rate set' | t: 'staff.expenditureRates.setAria' : { kind: kind }" [ngModel]="e.pick" (ngModelChange)="choose(kind, $event)">
                  @for (s of setsOf(kind); track s.effectiveFrom) {
                    <option [value]="s.effectiveFrom">{{ setLabel(s, d.today) }}</option>
                  }
                  <option [value]="''">{{ '+ New rate set' | t: 'staff.expenditureRates.newSetOption' }}</option>
                </select>
                @if (e.pick === '') { <input type="date" class="form-control" [attr.aria-label]="'{kind} date of effect' | t: 'staff.expenditureRates.dateAria' : { kind: kind }" [(ngModel)]="e.effectiveFrom" /> }
              </div>
            </div>
            <div class="table-responsive">
              <table class="table table-zed">
                @if (kind === 'Agency') {
                  <colgroup><col class="xr-c-level" /><col class="xr-c-flow" /><col /><col /><col /></colgroup>
                  <thead><tr><th>{{ 'Level' | t: 'staff.expenditureRates.column.level' }}</th><th>{{ 'Assessment flow (Admin)' | t: 'staff.expenditureRates.column.flow' }}</th><th class="num">{{ 'Completed' | t: 'staff.expenditureRates.column.completed' }}</th><th class="num">{{ 'Rejected after assessment' | t: 'staff.expenditureRates.column.rejected' }}</th><th class="num">{{ 'Surveillance visit' | t: 'staff.expenditureRates.column.surveillance' }}</th></tr></thead>
                  <tbody>
                    @for (l of d.agencyLevels; track l.level; let i = $index) {
                      <tr><td class="xr-level">{{ l.name }}</td><td class="xr-flow"><small>{{ l.flow }}</small></td>
                        <td class="num"><input type="number" min="0" class="form-control" [disabled]="locked" [attr.aria-label]="'{level} completed' | t: 'staff.expenditureRates.completedAria' : { level: l.name }" [(ngModel)]="e.levels[i].completed" /></td>
                        <td class="num"><input type="number" min="0" class="form-control" [disabled]="locked" [attr.aria-label]="'{level} rejected' | t: 'staff.expenditureRates.rejectedAria' : { level: l.name }" [(ngModel)]="e.levels[i].rejected" /></td>
                        <td class="num"><input type="number" min="0" class="form-control" [disabled]="locked" [attr.aria-label]="'{level} surveillance' | t: 'staff.expenditureRates.surveillanceAria' : { level: l.name }" [(ngModel)]="e.levels[i].surveillance" /></td></tr>
                    }
                  </tbody>
                } @else {
                  <colgroup><col class="xr-c-level" /><col class="xr-c-count" />@for (m of milestoneColumns(); track m) { <col /> }</colgroup>
                  <thead><tr><th>{{ 'Level' | t: 'staff.expenditureRates.column.level' }}</th><th class="num">{{ 'Milestones' | t: 'staff.expenditureRates.column.milestones' }}</th>@for (m of milestoneColumns(); track m) { <th class="num">{{ 'Milestone {number}' | t: 'staff.expenditureRates.column.milestone' : { number: m } }}</th> }</tr></thead>
                  <tbody>
                    @for (l of d.consultantLevels; track l.level; let i = $index) {
                      <tr><td class="xr-level">{{ l.name }}</td><td class="num">{{ l.milestones }}</td>
                        @for (m of milestoneColumns(); track m) {
                          <td class="num">@if (m <= l.milestones) {
                              <input type="number" min="0" class="form-control" [disabled]="locked" [attr.aria-label]="'{level} milestone {number}' | t: 'staff.expenditureRates.milestoneAria' : { level: l.name, number: m }" [(ngModel)]="e.levels[i].milestones[m - 1]" />
                            } @else { <span class="xr-na">{{ 'not used' | t: 'staff.expenditureRates.notUsed' }}</span> }</td>
                        }
                      </tr>
                    }
                  </tbody>
                }
              </table>
            </div>
            <div class="xr-foot">
              @if (locked) { <span>{{ 'Read-only: an approved invoice includes cases priced with this set. Add a new rate set to change the rates from a later date.' | t: 'staff.expenditureRates.lockedNote' }}</span> }
              @else if (kind === 'Agency') { <span>{{ agencyNote() }}</span> }
              @else { <span>{{ "The columns follow the level's handholding milestones. A milestone counts when the MSME pays the next milestone; the last milestone counts when the unit is certified at the level." | t: 'staff.expenditureRates.consultant.note' }}</span> }
              @if (set?.savedBy) { <span>{{ 'Saved by {name}, {date}' | t: 'staff.expenditureRates.savedBy' : { name: set!.savedBy, date: date(set!.savedOn) } }}</span> }
              <button type="button" class="btn btn-primary" [disabled]="locked || busy()" (click)="save(kind)">{{ e.pick === '' ? ('Add rate set' | t: 'staff.expenditureRates.addButton') : ('Save rates' | t: 'staff.expenditureRates.saveButton') }}</button>
            </div>
          </div>
        }
      </div>
      <div class="xr-gst"><label for="xr-gst">{{ 'GST % added on invoices' | t: 'staff.expenditureRates.gst.label' }}</label>
        <input id="xr-gst" type="number" min="0" max="100" step="0.01" class="form-control" [(ngModel)]="gst" /></div>
    } @else if (!error()) {
      <p role="status">{{ 'Loading…' | t: 'staff.expenditureRates.loading' }}</p>
    }

    @if (history(); as h) {
      <div class="xd-back" (click)="history.set(null)"></div>
      <div class="xd wide" role="dialog" aria-modal="true" aria-labelledby="rh-title">
        <div class="xd-head"><span class="xd-ico" aria-hidden="true">⟲</span><div><h3 id="rh-title">{{ 'Rate history' | t: 'staff.expenditureRates.history.title' }}</h3><small>{{ 'Every save of every rate set' | t: 'staff.expenditureRates.history.sub' }}</small></div>
          <button type="button" class="xd-x" [attr.aria-label]="'Close' | t: 'staff.expenditureRates.history.closeAria'" (click)="history.set(null)">×</button></div>
        <div class="xd-body">
          <table class="table table-zed rh-table">
            <colgroup><col class="rh-c-payee" /><col class="rh-c-date" /><col /><col class="rh-c-gst" /><col class="rh-c-by" /><col class="rh-c-on" /></colgroup>
            <thead><tr><th>{{ 'Payee' | t: 'staff.expenditureRates.history.column.payee' }}</th><th>{{ 'Date of effect' | t: 'staff.expenditureRates.history.column.date' }}</th><th>{{ 'Rates' | t: 'staff.expenditureRates.history.column.rates' }}</th><th class="num">{{ 'GST' | t: 'staff.expenditureRates.history.column.gst' }}</th><th>{{ 'Saved by' | t: 'staff.expenditureRates.history.column.savedBy' }}</th><th>{{ 'Saved on' | t: 'staff.expenditureRates.history.column.savedOn' }}</th></tr></thead>
            <tbody>
              @for (r of h; track $index) {
                <tr><td>{{ payee(r.kind) }}</td><td class="nowrap">{{ dmy(r.effectiveFrom) }}@if (!r.current) { <small class="rh-replaced">{{ 'replaced' | t: 'staff.expenditureRates.history.replaced' }}</small> }</td>
                  <td><small>@for (line of ratesText(r).split(' · '); track $index) { <span class="rh-line">{{ line }}</span> }</small></td><td class="num">{{ r.gstPercent }}%</td><td>{{ r.savedBy || '—' }}</td><td class="nowrap">{{ date(r.savedOn) }}</td></tr>
              } @empty { <tr><td colspan="6"><div class="no-data">{{ 'No rates saved yet.' | t: 'staff.expenditureRates.history.empty' }}</div></td></tr> }
            </tbody>
          </table>
        </div>
        <div class="xd-foot">
          <button type="button" class="btn btn-outline-primary" [disabled]="!h.length" (click)="exportHistory(h)">{{ 'Export' | t: 'staff.expenditureRates.history.exportButton' }}</button>
          <button type="button" class="btn btn-default" (click)="history.set(null)">{{ 'Close' | t: 'staff.expenditureRates.history.closeButton' }}</button>
        </div>
      </div>
    }
  `,
})
export class ExpenditureRatesPage {
  private readonly api = inject(ExpenditureApi);
  private readonly excel = inject(TableExport);
  private readonly toast = inject(ToastService);

  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.expenditureRates.crumb.fees', 'Fees'), link: '/staff/fees' },
    { label: t('staff.expenditureRates.crumb.rates', 'Expenditure rates') }));
  protected readonly agencyNote = computed(() => t('staff.expenditureRates.agency.note',
    'A case counts when the last assessment step of the level\'s flow is done; "rejected after assessment" only after that step.'));
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
      this.toast.error(t('staff.expenditureRates.toast.notSaved', 'Rates not saved'), apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async openHistory(): Promise<void> {
    try {
      this.history.set(await firstValueFrom(this.api.rateHistory()));
    } catch (e) {
      this.toast.error(t('staff.expenditureRates.toast.historyFailed', 'Rate history could not be loaded'), apiErrorMessage(e));
    }
  }

  /** A rate set in the "Date of effect" list: its date, whether it is in force or future, and read-only. */
  protected setLabel(s: RateSet, today: string): string {
    const date = dmy(s.effectiveFrom);
    if (s.inForce) return s.locked ? t('staff.expenditureRates.set.inForceLocked', '{date} (in force) · read-only', { date })
      : t('staff.expenditureRates.set.inForce', '{date} (in force)', { date });
    if (s.effectiveFrom > today) return s.locked ? t('staff.expenditureRates.set.futureLocked', '{date} (future) · read-only', { date })
      : t('staff.expenditureRates.set.future', '{date} (future)', { date });
    return s.locked ? t('staff.expenditureRates.set.locked', '{date} · read-only', { date }) : date;
  }

  protected payee(kind: PayeeKind): string {
    return kind === 'Agency' ? t('staff.expenditureRates.payee.agency', 'Assessment agency') : t('staff.expenditureRates.payee.consultant', 'Consultant organisation');
  }

  protected ratesText(r: RateHistoryEntry): string {
    return r.levels.map((l) => r.kind === 'Agency'
      ? `${l.level}: ${rupees(l.completed)} / ${rupees(l.rejected)} / ${rupees(l.surveillance)}`
      : `${l.level}: ${l.milestones.map((m) => rupees(m)).join(' / ')}`).join(' · ');
  }

  protected async exportHistory(h: RateHistoryEntry[]): Promise<void> {
    const rows = h.flatMap((r) => r.levels.map((l) => [this.payee(r.kind), r.effectiveFrom, l.level,
      l.completed, l.rejected, l.surveillance, l.milestones[0] ?? null, l.milestones[1] ?? null, l.milestones[2] ?? null, r.gstPercent, r.savedBy, indianTime(r.savedOn),
      r.current ? t('staff.expenditureRates.export.current', 'Current') : t('staff.expenditureRates.export.replaced', 'Replaced')]));
    try {
      await this.excel.xlsx('expenditure-rate-history', [{
        name: t('staff.expenditureRates.export.sheet', 'Rate history'),
        columns: [t('staff.expenditureRates.export.column.payee', 'Payee'), t('staff.expenditureRates.export.column.date', 'Date of effect'),
          t('staff.expenditureRates.export.column.level', 'Level'), t('staff.expenditureRates.export.column.completed', 'Completed'),
          t('staff.expenditureRates.export.column.rejected', 'Rejected after assessment'), t('staff.expenditureRates.export.column.surveillance', 'Surveillance visit'),
          t('staff.expenditureRates.export.column.milestone1', 'Milestone 1'), t('staff.expenditureRates.export.column.milestone2', 'Milestone 2'),
          t('staff.expenditureRates.export.column.milestone3', 'Milestone 3'), t('staff.expenditureRates.export.column.gst', 'GST %'),
          t('staff.expenditureRates.export.column.savedBy', 'Saved by'), t('staff.expenditureRates.export.column.savedOn', 'Saved on'),
          t('staff.expenditureRates.export.column.state', 'State')],
        rows,
      }]);
    } catch (e) {
      this.toast.error(t('staff.expenditureRates.toast.exportFailed', 'Export failed'), apiErrorMessage(e));
    }
  }
}
