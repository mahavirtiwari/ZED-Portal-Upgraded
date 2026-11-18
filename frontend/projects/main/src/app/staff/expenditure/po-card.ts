import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { AdminPortal } from '../admin-portal';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import { ExpenditureApi, PoChange, PoItem, PoLevel, PoView, poPill, shownDate } from './expenditure.api';

type Form =
  | { kind: 'add'; level: string; poNumber: string; poDate: string; cases: number | null }
  | { kind: 'edit'; level: string; id: number; poNumber: string; poDate: string; cases: number | null; reason: string }
  | { kind: 'reopen'; level: string; mode: 'extra' | 'new'; reason: string; extraCases: number | null; poNumber: string; poDate: string; cases: number | null };

/**
 * 2026-11-18 (approved design, section 2): an agency's (consultant organisation's) purchase orders per level, on Agency Level
 * Allocation and the Consultant Organisations page: cases in the PO, used (counted since the PO), a use bar (amber from 90%,
 * red at 100%) and whether allotment is open. The master admin who created the agency adds, edits and reopens them (a reason
 * and extra cases or a new PO); the Admin sees them. "History" lists every change.
 */
@Component({
  selector: 'zed-po-card',
  imports: [FormsModule],
  styleUrl: './exp-dialog.scss',
  styles: `
    :host { display: block; margin-bottom: 16px; }
    .po-card { padding: 0; overflow: hidden; }
    .po-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid #dde7e8; }
    .po-head h3 { margin: 0; font-size: 16px; font-weight: 700; color: #17373b; }
    .po-head .po-acts { margin-left: auto; display: flex; gap: 8px; }
    .bar { display: inline-block; width: 90px; height: 8px; border-radius: 4px; background: #ecf0f0; overflow: hidden; vertical-align: middle; margin-right: 6px; }
    .bar i { display: block; height: 100%; background: #3ba3ad; }
    .bar i.low { background: #d98a12; }
    .bar i.stop { background: #c8473c; }
    .po-sub { display: block; font-size: 11.5px; color: #6f8487; }
    .po-note { margin: 0; padding: 10px 16px; font-size: 12.5px; color: #6f8487; border-top: 1px solid #dde7e8; }
  `,
  template: `
    <div class="zed-card po-card">
      <div class="po-head">
        <span class="xd-ico" aria-hidden="true">PO</span>
        <h3>{{ view()?.partyName ?? partyName() }} · purchase orders</h3>
        <div class="po-acts">
          <button type="button" class="btn btn-default btn-sm" (click)="openHistory()">History</button>
          <button type="button" class="btn btn-default btn-sm" [disabled]="!view()?.levels?.length" (click)="export()">Export</button>
          @if (view()?.canEdit) { <button type="button" class="btn btn-outline-primary btn-sm" (click)="startAdd()">+ Add PO</button> }
        </div>
      </div>
      @if (error()) { <div class="alert alert-danger m-3" role="alert">{{ error() }}</div> }
      <div class="table-responsive">
        <table class="table table-zed mb-0">
          <thead><tr><th>Level</th><th>PO number</th><th>PO date</th><th class="num">Cases in PO</th><th class="num">Used</th><th>Use</th><th>Allotment</th><th></th></tr></thead>
          <tbody>
            @for (l of view()?.levels ?? []; track l.level) {
              @let pp = pill(l);
              <tr>
                <td>{{ l.name }}</td>
                <td>@for (p of l.pos; track p.id) { <span class="d-block">{{ p.poNumber }}</span> }</td>
                <td>@for (p of l.pos; track p.id) { <span class="d-block">{{ date(p.poDate) }}</span> }</td>
                <td class="num">{{ l.cases }}</td>
                <td class="num">{{ l.used }}@if (l.inProgress) { <span class="po-sub">+{{ l.inProgress }} in progress</span> }</td>
                <td><span class="bar" aria-hidden="true"><i [class.low]="l.state === 'Low'" [class.stop]="l.state === 'Stopped'" [style.width.%]="l.percent"></i></span>{{ l.percent }}%</td>
                <td><span class="status-badge" [class]="pp.tone">{{ pp.text }}</span></td>
                <td class="num">
                  @if (view()?.canEdit) {
                    @if (l.state === 'Stopped' || l.state === 'Low') {
                      <button type="button" class="btn btn-outline-primary btn-sm" (click)="startReopen(l)">Reopen</button>
                    }
                    <button type="button" class="btn btn-default btn-sm ms-1" (click)="startEdit(l, l.pos[l.pos.length - 1])">Edit</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="8"><div class="no-data">{{ loading() ? 'Loading…' : 'No purchase order yet: allotment has no limit until one is added.' }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="po-note">When the cases in a PO are used up (completed, rejected after assessment, or in progress), allotment to this
        {{ word() }} for that level stops and says why. <b>Reopen</b> asks for a reason and either extra cases (a PO amendment) or a new PO; it is kept in the history.</p>
    </div>

    @if (form(); as f) {
      <div class="xd-back" (click)="form.set(null)"></div>
      <form class="xd" role="dialog" aria-modal="true" aria-labelledby="po-title" (ngSubmit)="save()">
        <div class="xd-head">
          <span class="xd-ico" aria-hidden="true">PO</span>
          <div><h3 id="po-title">{{ f.kind === 'add' ? 'Add purchase order' : f.kind === 'edit' ? 'Edit purchase order' : 'Reopen allotment' }}</h3>
            <small>{{ view()?.partyName }}</small></div>
          <button type="button" class="xd-x" aria-label="Close" (click)="form.set(null)">×</button>
        </div>
        <div class="xd-body">
          @if (formError()) { <div class="alert alert-danger xd-err" role="alert">{{ formError() }}</div> }
          @if (f.kind === 'add') {
            <label class="xd-field"><span>Level</span>
              <select class="form-select" name="level" [(ngModel)]="f.level">
                @for (o of view()?.levelOptions ?? []; track o.code) { <option [value]="o.code">{{ o.name }}</option> }
              </select></label>
          } @else {
            <p><b>{{ levelName(f.level) }}</b></p>
          }
          @if (f.kind === 'reopen') {
            <label class="xd-field"><span>Reason</span><textarea class="form-control" rows="2" maxlength="1000" name="reason" [(ngModel)]="f.reason"></textarea></label>
            <div class="xd-field" role="radiogroup" aria-label="How to reopen">
              <label class="me-3"><input type="radio" name="mode" value="extra" [(ngModel)]="f.mode" /> Extra cases (PO amendment)</label>
              <label><input type="radio" name="mode" value="new" [(ngModel)]="f.mode" /> A new PO</label>
            </div>
            @if (f.mode === 'extra') {
              <label class="xd-field"><span>Extra cases</span><input type="number" min="1" class="form-control" name="extra" [(ngModel)]="f.extraCases" /></label>
            }
          }
          @if (f.kind !== 'reopen' || f.mode === 'new') {
            <label class="xd-field"><span>PO number</span><input class="form-control" maxlength="100" name="poNumber" [(ngModel)]="f.poNumber" /></label>
            <label class="xd-field"><span>PO date</span><input type="date" class="form-control" name="poDate" [(ngModel)]="f.poDate" /></label>
            <label class="xd-field"><span>Cases in PO</span><input type="number" min="1" class="form-control" name="cases" [(ngModel)]="f.cases" /></label>
          }
          @if (f.kind === 'edit') {
            <label class="xd-field"><span>Reason (optional)</span><input class="form-control" maxlength="1000" name="reason" [(ngModel)]="f.reason" /></label>
          }
        </div>
        <div class="xd-foot">
          <button type="button" class="btn btn-default" (click)="form.set(null)">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ f.kind === 'reopen' ? 'Reopen' : 'Save' }}</button>
        </div>
      </form>
    }

    @if (history(); as h) {
      <div class="xd-back" (click)="history.set(null)"></div>
      <div class="xd" role="dialog" aria-modal="true" aria-labelledby="poh-title">
        <div class="xd-head"><span class="xd-ico" aria-hidden="true">⟲</span>
          <div><h3 id="poh-title">Purchase order history</h3><small>{{ view()?.partyName }}</small></div>
          <button type="button" class="xd-x" aria-label="Close" (click)="history.set(null)">×</button></div>
        <div class="xd-body">
          <table class="table table-zed">
            <thead><tr><th>When</th><th>Level</th><th>Change</th><th class="num">Cases</th><th>By</th></tr></thead>
            <tbody>
              @for (c of h; track c.id) {
                <tr><td>{{ date(c.on) }}</td><td>{{ c.levelName }}</td>
                  <td>{{ changeText(c) }}@if (c.reason) { <span class="po-sub">Reason: {{ c.reason }}</span> }@if (c.details) { <span class="po-sub">{{ c.details }}</span> }</td>
                  <td class="num">{{ c.casesBefore ?? '—' }} → {{ c.casesAfter ?? '—' }}</td><td>{{ c.by || '—' }}</td></tr>
              } @empty { <tr><td colspan="5"><div class="no-data">No change yet.</div></td></tr> }
            </tbody>
          </table>
        </div>
        <div class="xd-foot"><button type="button" class="btn btn-default" (click)="history.set(null)">Close</button></div>
      </div>
    }
  `,
})
export class PoCard {
  private readonly api = inject(ExpenditureApi);
  private readonly excel = inject(TableExport);
  private readonly toast = inject(ToastService);

  readonly partyId = input.required<string>();
  readonly partyName = input('');
  /** The Admin on main reading a consultant organisation's POs (Consultancy portal). */
  readonly portal = input<AdminPortal | null>(null);
  /** "agency" or "organisation" (the note's wording). */
  readonly word = input('agency');

  protected readonly view = signal<PoView | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly form = signal<Form | null>(null);
  protected readonly formError = signal('');
  protected readonly busy = signal(false);
  protected readonly history = signal<PoChange[] | null>(null);
  protected readonly date = shownDate;

  constructor() {
    effect(() => {
      const id = this.partyId();
      untracked(() => void this.load(id));
    });
  }

  async load(id = this.partyId()): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.view.set(await firstValueFrom(this.api.po(id, this.portal())));
    } catch (e) {
      this.view.set(null);
      this.error.set(apiErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected pill(l: PoLevel) {
    return poPill(l.state, l.left);
  }

  protected levelName(code: string): string {
    return this.view()?.levelOptions.find((o) => o.code === code)?.name ?? code;
  }

  protected startAdd(): void {
    const used = new Set((this.view()?.levels ?? []).map((l) => l.level));
    const first = this.view()?.levelOptions.find((o) => !used.has(o.code))?.code ?? this.view()?.levelOptions[0]?.code ?? '';
    this.formError.set('');
    this.form.set({ kind: 'add', level: first, poNumber: '', poDate: '', cases: null });
  }

  protected startEdit(l: PoLevel, p: PoItem): void {
    this.formError.set('');
    this.form.set({ kind: 'edit', level: l.level, id: p.id, poNumber: p.poNumber, poDate: p.poDate, cases: p.cases, reason: '' });
  }

  protected startReopen(l: PoLevel): void {
    this.formError.set('');
    this.form.set({ kind: 'reopen', level: l.level, mode: 'extra', reason: '', extraCases: null, poNumber: '', poDate: '', cases: null });
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const partyId = this.partyId();
    this.busy.set(true);
    this.formError.set('');
    try {
      const r = await firstValueFrom(
        f.kind === 'add'
          ? this.api.addPo({ partyId, level: f.level, poNumber: f.poNumber, poDate: f.poDate, cases: f.cases })
          : f.kind === 'edit'
            ? this.api.editPo(f.id, { poNumber: f.poNumber, poDate: f.poDate, cases: f.cases, reason: f.reason })
            : this.api.reopenPo(f.mode === 'extra'
              ? { partyId, level: f.level, reason: f.reason, extraCases: f.extraCases }
              : { partyId, level: f.level, reason: f.reason, poNumber: f.poNumber, poDate: f.poDate, cases: f.cases }),
      );
      this.toast.success(r.message);
      this.form.set(null);
      await this.load();
    } catch (e) {
      this.formError.set(apiErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async openHistory(): Promise<void> {
    try {
      this.history.set(await firstValueFrom(this.api.poHistory(this.partyId(), this.portal())));
    } catch (e) {
      this.toast.error('History could not be loaded', apiErrorMessage(e));
    }
  }

  protected changeText(c: PoChange): string {
    return { Added: 'PO added', Edited: 'PO edited', Amended: 'Reopened: extra cases', NewPo: 'Reopened: new PO' }[c.type] ?? c.type;
  }

  protected async export(): Promise<void> {
    const v = this.view();
    if (!v) return;
    try {
      await this.excel.xlsx(`purchase-orders-${v.partyId}`, [{
        name: 'Purchase orders',
        columns: ['Level', 'PO number', 'PO date', 'Cases in PO', 'Used', 'In progress', 'Left', 'Use %', 'Allotment'],
        rows: v.levels.map((l) => [l.name, l.pos.map((p) => p.poNumber).join(', '), l.pos.map((p) => p.poDate).join(', '), l.cases, l.used, l.inProgress,
          l.left, l.percent, poPill(l.state, l.left).text]),
      }]);
    } catch (e) {
      this.toast.error('Export failed', apiErrorMessage(e));
    }
  }
}
