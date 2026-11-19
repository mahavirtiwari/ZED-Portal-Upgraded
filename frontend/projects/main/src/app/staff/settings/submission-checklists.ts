import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ALL_PORTALS, PortalSwitchComponent } from '../admin-portal';
import { ConfirmService } from '../confirm-dialog';
import { TextPipe, t } from '../../content/page-text';

/** An item ticked before a submission (Zed.Core.Assessment.ChecklistItem). Empty stages: always asked. */
export interface ChecklistItemDef {
  /** Stable key (never changed once saved). */
  id: string;
  text: string;
  stages: string[];
  active: boolean;
}

export interface ChecklistView {
  code: string;
  title: string;
  /** Who ticks it ("agency", "assessor", …). */
  who: string;
  /** Where an item can be asked (Desktop / Site, Desktop / Remote / Onsite; none for the handholding lists). */
  stages: string[];
  items: ChecklistItemDef[];
  customised: boolean;
}

/** The server's limits (Zed.Core.Assessment.SubmissionChecklists). */
export const CHECKLIST_LIMITS = { items: 15, text: 250 } as const;

/** How a stage reads on the page (the code value stays in the data). */
export function stageLabel(s: string): string {
  switch (s) {
    case 'Desktop': return t('staff.submissionChecklists.stage.desktop', 'Desktop');
    case 'Site': return t('staff.submissionChecklists.stage.site', 'Site');
    case 'Remote': return t('staff.submissionChecklists.stage.remote', 'Remote');
    case 'Onsite': return t('staff.submissionChecklists.stage.onsite', 'Onsite (app)');
    default: return s;
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** A key for a new item from its text: "All photos seen" → "all-photos-seen" (with -2, -3… when taken). */
export function itemId(text: string, taken: readonly string[]): string {
  const used = new Set(taken.map((x) => x.toLowerCase()));
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 30).replace(/[-_]+$/, '') || 'item';
  if (!used.has(base) && ID_PATTERN.test(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id) && ID_PATTERN.test(id)) return id;
  }
}

interface Editing {
  /** Null: a new item. */
  item: ChecklistItemDef | null;
  text: string;
  stages: string[];
  active: boolean;
}

/**
 * Admin → Submission checklists (2026-11-17, approved): the items the assessor (consultant) ticks before the final submit and the
 * agency (consultant organisation) before its quality-check approval. Laid out as Site Tour Sections: the portal switch (each
 * portal keeps its own lists), the checklist picker, count tiles, a compact list with arrows, an On/Off switch and Edit, and a
 * pop-up to add or edit an item. Each change saves the checklist's whole list (PUT); "Reset to standard items" goes back to the
 * standard ones. A list with no item in use asks nothing.
 */
@Component({
  selector: 'zed-staff-submission-checklists',
  imports: [FormsModule, PortalSwitchComponent, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Submission checklists' | t: 'staff.submissionChecklists.title' }}</h3>
        <p class="page-sub">{{ 'What must be ticked before a final submit or a quality-check approval. The ticks are recorded with each submission.' | t: 'staff.submissionChecklists.sub' }}</p>
      </div>
      @if (current(); as c) {
        <div class="page-actions">
          <button type="button" class="btn btn-default" [disabled]="!c.customised || busy()" (click)="resetAll(c)">{{ 'Reset to standard items' | t: 'staff.submissionChecklists.resetButton' }}</button>
          <button type="button" class="btn btn-primary" [disabled]="c.items.length >= limits.items || busy()"
            [title]="c.items.length >= limits.items ? ('At most {count} items' | t: 'staff.submissionChecklists.addLimitTooltip' : { count: limits.items }) : ''" (click)="add()">{{ 'Add item' | t: 'staff.submissionChecklists.addButton' }}</button>
        </div>
      }
    </div>
    <zed-portal-switch [portals]="portals" />
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }

    @if (data(); as list) {
      <div class="cl-pick" role="group" [attr.aria-label]="'Checklist' | t: 'staff.submissionChecklists.picker.label'">
        <span class="cl-pick-label">{{ 'Checklist' | t: 'staff.submissionChecklists.picker.label' }}</span>
        <div class="seg">
          @for (c of list; track c.code) {
            <button type="button" [class.active]="c.code === current()?.code" [attr.aria-pressed]="c.code === current()?.code" [attr.data-checklist]="c.code"
              (click)="pick(c.code)">{{ c.title }}</button>
          }
        </div>
      </div>
    }

    @if (current(); as c) {
      <div class="st-tiles">
        <div class="st-tile"><b>{{ c.items.length }}</b><small>{{ 'Items ({count} on)' | t: 'staff.submissionChecklists.tile.items' : { count: activeCount() } }}</small></div>
        <div class="st-tile"><b>{{ stageCounts() }}</b><small>{{ c.stages.length ? ('Asked at {stages}' | t: 'staff.submissionChecklists.tile.askedAt' : { stages: stageNames(c) }) : ('Asked at every final submit' | t: 'staff.submissionChecklists.tile.askedAlways') }}</small></div>
        <div class="st-tile"><b class="st-word">{{ c.customised ? ('Changed' | t: 'staff.submissionChecklists.tile.changed') : ('Standard' | t: 'staff.submissionChecklists.tile.standard') }}</b><small>{{ c.customised ? ('Changed by the Admin' | t: 'staff.submissionChecklists.tile.changedNote') : ('Not changed yet' | t: 'staff.submissionChecklists.tile.standardNote') }}</small></div>
      </div>
      <p class="sync-note">
        <span class="info-dot" aria-hidden="true">i</span>
        {{ 'Ticked by the {who}. Every item in use must be ticked; a change applies to the next submission.' | t: 'staff.submissionChecklists.note' : { who: c.who } }}
      </p>
      <div class="table-responsive">
        <table class="table table-zed items-table">
          <colgroup>
            <col style="width: 56px" />
            <col />
            @if (c.stages.length) { <col style="width: 220px" /> }
            <col class="col-actions" style="width: 268px" />
          </colgroup>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th>{{ 'Item (what the user confirms)' | t: 'staff.submissionChecklists.column.item' }}</th>
              @if (c.stages.length) { <th>{{ 'Asked at' | t: 'staff.submissionChecklists.column.askedAt' }}</th> }
              <th class="text-end">{{ 'Action' | t: 'staff.submissionChecklists.column.action' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (i of c.items; track i.id; let n = $index, last = $last) {
              <tr [class.is-off]="!i.active" [attr.data-id]="i.id">
                <td class="text-center"><span class="order-no">{{ n + 1 }}</span></td>
                <td>
                  <span class="item-text">{{ i.text }}</span>
                </td>
                @if (c.stages.length) {
                  <td><div class="scope">@for (s of i.stages; track s) { <span class="zed-chip">{{ stageLabel(s) }}</span> }</div></td>
                }
                <td>
                  <div class="st-actions">
                    <button type="button" class="btn btn-outline-primary btn-sm st-move" [title]="'Move up' | t: 'staff.submissionChecklists.row.moveUpTooltip'" [attr.aria-label]="'Move up' | t: 'staff.submissionChecklists.row.moveUpTooltip'" [disabled]="n === 0 || busy()" (click)="move(c, n, -1)">↑</button>
                    <button type="button" class="btn btn-outline-primary btn-sm st-move" [title]="'Move down' | t: 'staff.submissionChecklists.row.moveDownTooltip'" [attr.aria-label]="'Move down' | t: 'staff.submissionChecklists.row.moveDownTooltip'" [disabled]="last || busy()" (click)="move(c, n, 1)">↓</button>
                    <label class="st-switch" [class.off]="!i.active" [title]="i.active ? ('Switch this item off' | t: 'staff.submissionChecklists.row.offTooltip') : ('Switch this item on' | t: 'staff.submissionChecklists.row.onTooltip')">
                      <input type="checkbox" role="switch" [checked]="i.active" [disabled]="busy()" [attr.aria-label]="i.active ? ('Switch off {item}' | t: 'staff.submissionChecklists.row.offAria' : { item: i.text }) : ('Switch on {item}' | t: 'staff.submissionChecklists.row.onAria' : { item: i.text })"
                        (click)="$event.preventDefault(); toggle(c, n)" />
                      <span class="st-track" aria-hidden="true"></span>{{ i.active ? ('On' | t: 'staff.submissionChecklists.row.on') : ('Off' | t: 'staff.submissionChecklists.row.off') }}
                    </label>
                    <button type="button" class="btn btn-outline-primary btn-sm st-edit" [disabled]="busy()" (click)="edit(i)">{{ 'Edit' | t: 'staff.submissionChecklists.row.editButton' }}</button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr><td [attr.colspan]="c.stages.length ? 4 : 3" style="padding: 0"><div class="no-data">{{ 'No items: nothing is asked before the submission' | t: 'staff.submissionChecklists.empty' }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
    } @else if (!busy()) {
      <div class="no-data">{{ 'The checklists could not be loaded' | t: 'staff.submissionChecklists.loadError' }}</div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="itemTitle">
        <div class="modal-dialog modal-dialog-scrollable item-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-start gap-3">
                <h3 class="registration-title m-0" id="itemTitle">{{ e.item ? ('Edit item' | t: 'staff.submissionChecklists.dialog.editTitle') : ('Add item' | t: 'staff.submissionChecklists.dialog.addTitle') }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.submissionChecklists.dialog.closeAria'" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              @let p = check(e);
              <label class="form-label" for="itemText">{{ 'Item (up to {count} characters)' | t: 'staff.submissionChecklists.dialog.item.label' : { count: limits.text } }}<span class="req">*</span></label>
              <textarea class="form-control" id="itemText" rows="3" [maxlength]="limits.text" [placeholder]="itemPlaceholder()"
                [class.is-invalid]="p.text" [(ngModel)]="e.text"></textarea>
              @if (p.text) { <small class="invalid">{{ p.text }}</small> }
              @if (current()?.stages?.length) {
                <span class="form-label d-block mt-3">{{ 'Asked at' | t: 'staff.submissionChecklists.dialog.askedAt.label' }}<span class="req">*</span></span>
                <div class="stage-ticks">
                  @for (s of current()!.stages; track s) {
                    <label class="form-check m-0">
                      <input type="checkbox" class="form-check-input" [attr.data-stage]="s" [checked]="e.stages.includes(s)" (change)="tickStage(e, s, $any($event.target).checked)" />
                      <span class="form-check-label">{{ stageLabel(s) }}</span>
                    </label>
                  }
                </div>
                @if (p.stages) { <small class="invalid">{{ p.stages }}</small> }
              }
              <label class="check-line mt-3" for="itemActive">
                <input class="form-check-input" type="checkbox" id="itemActive" [(ngModel)]="e.active" />
                <span>{{ 'On (asked)' | t: 'staff.submissionChecklists.dialog.active.label' }}</span>
              </label>
              @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.submissionChecklists.dialog.cancelButton' }}</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="save(e)">{{ 'Save' | t: 'staff.submissionChecklists.dialog.saveButton' }}</button>
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
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .cl-pick { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 12px; }
    .cl-pick-label { font-size: 13px; color: #5f6f70; }
    .sync-note { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: flex-start; color: #5f6f70; font-size: 13px; margin: 0 0 12px; }
    .info-dot { flex: 0 0 18px; height: 18px; border-radius: 9px; background: #45a5ad; color: #fff; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; font-style: italic; font-family: Georgia, serif; }
    .items-table { table-layout: fixed; width: 100%; min-width: 800px; margin-bottom: 0; }
    .items-table td { overflow-wrap: break-word; vertical-align: top; padding-top: 12px; padding-bottom: 12px; }
    .items-table tr.is-off td { color: #8a9899; }
    .item-text { font-size: 14px; color: #232527; margin-right: 6px; }
    .is-off .item-text { color: #8a9899; }
    .order-no { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 14px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 13px; }
    .scope { display: flex; flex-wrap: wrap; gap: 2px 0; }
    .scope .zed-chip { font-size: 11px; padding: 1px 8px; }
    .st-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 12px; }
    .st-tile { background: #fff; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 14px; display: flex; flex-direction: column; }
    .st-tile b { font-size: 20px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .st-tile small { font-size: 12.5px; color: #5f6f70; }
    .st-tile b.st-word { font-size: 16px; line-height: 1.5; }
    /* 2026-11-19 (admin audit: "Edi/t" and "O/n" at 1536px): the action column is wide enough and its buttons never wrap. */
    .st-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: nowrap; white-space: nowrap; overflow-wrap: normal; }
    .st-actions > * { flex: none; }
    .st-actions .st-move { width: 32px; padding-left: 0; padding-right: 0; font-weight: 700; }
    /* position: relative keeps the hidden input inside the table's scroll box (it widened the page on phones). */
    .st-switch { position: relative; display: inline-flex; align-items: center; gap: 5px; margin: 0 4px; font-size: 12.5px; font-weight: 600; color: #1e7a3c; cursor: pointer; text-transform: none; }
    .st-switch.off { color: #8a9899; }
    .st-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .st-track { position: relative; width: 30px; height: 16px; border-radius: 9px; background: #45a5ad; flex: none; }
    .st-track::after { content: ''; position: absolute; top: 2px; left: 16px; width: 12px; height: 12px; border-radius: 50%; background: #fff; }
    .st-switch.off .st-track { background: #c3cdce; }
    .st-switch.off .st-track::after { left: 2px; }
    .st-switch input:focus-visible + .st-track { outline: 2px solid var(--zt-dark, #23656b); outline-offset: 2px; }
    .stage-ticks { display: flex; flex-wrap: wrap; gap: 6px 18px; }
    .stage-ticks .form-check { display: inline-flex; align-items: center; gap: 6px; padding-left: 0; }
    .stage-ticks .form-check-input { margin: 0; float: none; }
    .modal .item-dialog textarea.form-control { min-height: 72px; height: auto; }
    /* Phone: one card per row, no sideways scroll. */
    @media (max-width: 767.98px) {
      .st-tiles { grid-template-columns: minmax(0, 1fr); }
      .items-table { min-width: 0; table-layout: auto; }
      .items-table thead { display: none; }
      .items-table, .items-table tbody, .items-table tr, .items-table td { display: block; width: 100%; }
      .items-table tr { border: 1px solid #dfe9ea; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; background: #fff; }
      .items-table td { border: 0; padding: 4px 0; text-align: left !important; }
      .items-table td:first-child { display: none; }
      .items-table .st-actions { justify-content: flex-start; flex-wrap: wrap; padding-top: 4px; }
    }
    .check-line { display: flex; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }
    .check-line .form-check-input { margin: 0; float: none; flex: none; }
    .invalid { display: block; color: #a8303a; font-size: 12.5px; margin-top: 3px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class SubmissionChecklistsPage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private static readonly url = '/api/staff/settings/submission-checklists';

  protected readonly limits = CHECKLIST_LIMITS;
  protected readonly portals = ALL_PORTALS;
  protected readonly data = signal<ChecklistView[] | null>(null);
  protected readonly code = signal<string | null>(null);
  protected readonly current = computed(() => {
    const list = this.data();
    return list ? (list.find((c) => c.code === this.code()) ?? list[0] ?? null) : null;
  });
  protected readonly editing = signal<Editing | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');
  private readonly tried = signal(false);

  /** In code: an apostrophe cannot go in a pipe literal of an inline template. */
  protected readonly itemPlaceholder = computed(() => t('staff.submissionChecklists.dialog.item.placeholder', "e.g. Every requirement's evidence was verified."));
  protected readonly activeCount = computed(() => (this.current()?.items ?? []).filter((i) => i.active).length);

  /** "4 · 5": the items in use asked at each stage (the handholding lists: the items in use). */
  protected readonly stageCounts = computed(() => {
    const c = this.current();
    if (!c) return '';
    const on = c.items.filter((i) => i.active);
    return c.stages.length ? c.stages.map((s) => on.filter((i) => i.stages.includes(s)).length).join(' · ') : String(on.length);
  });

  constructor() {
    void this.load();
  }

  protected stageLabel(s: string): string {
    return stageLabel(s);
  }

  protected stageNames(c: ChecklistView): string {
    return c.stages.map((s) => this.stageLabel(s).toLowerCase()).join(' · ');
  }

  protected pick(code: string): void {
    this.code.set(code);
    this.success.set('');
    this.error.set('');
  }

  protected add(): void {
    const c = this.current();
    this.modalError.set('');
    this.tried.set(false);
    this.editing.set({ item: null, text: '', stages: [...(c?.stages ?? [])], active: true });
  }

  protected edit(i: ChecklistItemDef): void {
    this.modalError.set('');
    this.tried.set(false);
    this.editing.set({ item: i, text: i.text, stages: [...i.stages], active: i.active });
  }

  protected tickStage(e: Editing, stage: string, on: boolean): void {
    const stages = this.current()?.stages ?? [];
    const set = new Set(e.stages);
    if (on) set.add(stage);
    else set.delete(stage);
    this.editing.set({ ...e, stages: stages.filter((s) => set.has(s)) });
  }

  /** The server's rules (SubmissionChecklists.Problem) for the item being edited. */
  protected check(e: Editing): { text?: string; stages?: string } {
    const p: { text?: string; stages?: string } = {};
    const text = e.text.trim();
    const others = (this.current()?.items ?? []).filter((i) => i.id !== e.item?.id);
    if (!text) {
      if (this.tried()) p.text = t('staff.submissionChecklists.dialog.error.empty', 'Enter the item.');
    } else if (text.length > CHECKLIST_LIMITS.text) {
      p.text = t('staff.submissionChecklists.dialog.error.long', 'At most {count} characters.', { count: CHECKLIST_LIMITS.text });
    } else if (others.some((i) => i.text.trim().toLowerCase() === text.toLowerCase())) {
      p.text = t('staff.submissionChecklists.dialog.error.duplicate', 'Another item has this text.');
    }
    if ((this.current()?.stages.length ?? 0) > 0 && !e.stages.length) p.stages = t('staff.submissionChecklists.dialog.error.stages', 'Choose where it is asked.');
    return p;
  }

  protected async save(e: Editing): Promise<void> {
    const c = this.current();
    if (!c) return;
    this.tried.set(true);
    if (Object.keys(this.check(e)).length) return;
    const item: ChecklistItemDef = {
      id: e.item?.id ?? itemId(e.text.trim(), c.items.map((i) => i.id)),
      text: e.text.trim(),
      stages: [...e.stages],
      active: e.active,
    };
    const items = e.item ? c.items.map((i) => (i.id === e.item!.id ? item : i)) : [...c.items, item];
    this.busy.set(true);
    this.modalError.set('');
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(`${SubmissionChecklistsPage.url}/${c.code}`, { items }));
      this.editing.set(null);
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(c: ChecklistView, index: number): Promise<void> {
    const items = c.items.map((x) => ({ ...x }));
    const i = items[index];
    if (!i) return Promise.resolve();
    if (i.active && !(await this.confirms.ask({
      title: t('staff.submissionChecklists.offDialog.title', 'Switch the Item Off?'), subtitle: i.text,
      message: t('staff.submissionChecklists.offDialog.message', 'It is no longer asked.'),
      confirmLabel: t('staff.submissionChecklists.offDialog.confirmButton', 'Switch Off'), danger: true,
    }))) return;
    i.active = !i.active;
    return this.change(() => this.http.put<MessageResponse>(`${SubmissionChecklistsPage.url}/${c.code}`, { items }));
  }

  protected move(c: ChecklistView, index: number, by: -1 | 1): Promise<void> {
    const items = [...c.items];
    const target = index + by;
    if (target < 0 || target >= items.length) return Promise.resolve();
    [items[index], items[target]] = [items[target], items[index]];
    return this.change(() => this.http.put<MessageResponse>(`${SubmissionChecklistsPage.url}/${c.code}`, { items }));
  }

  protected async resetAll(c: ChecklistView): Promise<void> {
    if (!(await this.confirms.ask({
      title: t('staff.submissionChecklists.resetDialog.title', 'Reset to the Standard Items?'),
      message: t('staff.submissionChecklists.resetDialog.message', 'The {checklist} checklist uses its standard items again. The items added or changed here are removed.', { checklist: c.title }),
      confirmLabel: t('staff.submissionChecklists.resetDialog.confirmButton', 'Reset'), danger: true,
    }))) return;
    return this.change(() => this.http.delete<MessageResponse>(`${SubmissionChecklistsPage.url}/${c.code}`));
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
      this.data.set((await firstValueFrom(this.http.get<{ checklists: ChecklistView[] }>(SubmissionChecklistsPage.url))).checklists);
    } catch (err) {
      this.data.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
