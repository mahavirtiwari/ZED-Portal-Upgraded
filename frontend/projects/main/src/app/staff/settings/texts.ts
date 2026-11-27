import { HttpClient } from '@angular/common/http';
import { Component, DOCUMENT, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PagedView, PagerComponent } from '../pager';
import { PortalSwitchComponent } from '../admin-portal';
import { ConfirmService } from '../confirm-dialog';
import { IndianTimePipe } from '../utc-time';
import { fillSampleFields, insertAtCursor, portalBaseUrl } from './email-templates';
import { PageTextsPanel } from './page-texts';
import { TextPipe, t } from '../../content/page-text';

export interface TextItem {
  key: string;
  name: string;
  group: string;
  /** "Website" or "Mobile app". */
  channel: string;
  enabled: boolean;
  /** The Admin saved something for it (hidden or own text). */
  customised: boolean;
  placeholders: string[];
  updatedBy: string | null;
  updatedOn: string | null;
}

interface TextDetails {
  item: TextItem;
  bodyHtml: string;
  standardHtml: string;
}

interface Editing {
  item: TextItem;
  enabled: boolean;
  body: string;
  standard: string;
}

/** Which texts the list shows (the buttons beside the search box). */
type StatusFilter = 'all' | 'shown' | 'hidden' | 'changed';

/**
 * Admin → Texts (new in V4): the disclaimers, instructions, undertakings and pledges of this portal's pages and of its
 * mobile apps. An Admin can hide a text, change its wording (HTML, with the {{Fields}} the page fills in), or reset it. V4
 * layout: the counts, the website / app tabs, search and a status filter, each text with where it shows and its fields;
 * the editor pop-up has the HTML beside its preview in a page frame (desktop or phone width; phone first for the apps),
 * whether it is the standard text, and field chips that put a field at the cursor.
 */
@Component({
  selector: 'zed-staff-texts',
  imports: [IndianTimePipe, FormsModule, PagerComponent, PortalSwitchComponent, PageTextsPanel, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Texts' | t: 'staff.texts.title' }}</h3>
        <p class="page-sub">{{ 'Disclaimers, instructions, undertakings and pledges of the website and the apps. A change shows on the website within a minute (on a page opened or reloaded after it) and in the apps when they are next opened or brought back to the front.' | t: 'staff.texts.sub' }}</p>
      </div>
    </div>
    <!-- One Admin (V4): the texts of the portal chosen here (each portal keeps its own). -->
    <zed-portal-switch [reload]="false" (changed)="reload()" />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <!-- 2026-11-19 (the user: "all the text are configurable"): the pages' wording (headings, labels, buttons, notes) beside
         the HTML texts. -->
    <div class="tx-kinds" role="tablist" [attr.aria-label]="'Kind of text' | t: 'staff.texts.kinds.aria'">
      <button type="button" role="tab" class="tx-kind" [class.active]="kind() === 'texts'" [attr.aria-selected]="kind() === 'texts'" (click)="kind.set('texts')">{{ 'Messages and documents' | t: 'staff.texts.kinds.textsButton' }}</button>
      <button type="button" role="tab" class="tx-kind" [class.active]="kind() === 'wording'" [attr.aria-selected]="kind() === 'wording'" (click)="kind.set('wording')">{{ 'Page wording' | t: 'staff.texts.kinds.wordingButton' }}</button>
    </div>
    @if (kind() === 'wording') {
      <zed-page-texts />
    } @else {
    <div class="tx-stats">
      <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">{{ 'Texts' | t: 'staff.texts.count.total' }}</span></div>
      <div class="stat"><span class="stat-value is-shown">{{ stats().shown }}</span><span class="stat-label">{{ 'Shown' | t: 'staff.texts.count.shown' }}</span></div>
      <div class="stat"><span class="stat-value is-off">{{ stats().hidden }}</span><span class="stat-label">{{ 'Hidden' | t: 'staff.texts.count.hidden' }}</span></div>
      <div class="stat"><span class="stat-value">{{ stats().changed }}</span><span class="stat-label">{{ 'Changed by Admin' | t: 'staff.texts.count.changed' }}</span></div>
    </div>

    <div class="zed-card list-card">
      <div class="tx-tabs" role="tablist">
        @for (c of channels; track c) {
          <button type="button" role="tab" class="tx-tab" [class.active]="channel() === c" [attr.aria-selected]="channel() === c"
                  (click)="channel.set(c)">{{ c === 'Website' ? ('Website ({count})' | t: 'staff.texts.tab.website' : { count: count(c) }) : ('Mobile app ({count})' | t: 'staff.texts.tab.app' : { count: count(c) }) }}</button>
        }
      </div>
      <div class="list-toolbar">
        <input type="search" class="form-control search" [placeholder]="'Search text or page' | t: 'staff.texts.search.placeholder'" [attr.aria-label]="'Search texts' | t: 'staff.texts.search.aria'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        <div class="seg" role="group" [attr.aria-label]="'Show' | t: 'staff.texts.filter.aria'">
          @for (f of filters(); track f.key) {
            <button type="button" [class.active]="filter() === f.key" [attr.aria-pressed]="filter() === f.key" (click)="filter.set(f.key)">{{ f.label }}</button>
          }
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-zed tx-table">
          <thead>
            <tr>
              <th class="text-center col-sno">{{ 'S.No' | t: 'staff.texts.column.sno' }}</th>
              <th>{{ 'Text' | t: 'staff.texts.column.text' }}</th>
              <th class="col-status">{{ 'Status' | t: 'staff.texts.column.status' }}</th>
              <th class="col-change">{{ 'Last change' | t: 'staff.texts.column.lastChange' }}</th>
              <th class="text-end col-action">{{ 'Action' | t: 'staff.texts.column.action' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (tx of view.page(); track tx.key) {
              <tr [class.is-off]="!tx.enabled">
                <td class="text-center">{{ view.serial($index) }}</td>
                <td>
                  <div class="tx">
                    <span class="tx-icon" [class.app]="tx.channel !== 'Website'" aria-hidden="true">{{ tx.channel === 'Website' ? 'WWW' : 'APP' }}</span>
                    <div class="tx-text">
                      <strong>{{ tx.name }}</strong>
                      <small class="muted d-block">{{ tx.group }}@if (tx.placeholders.length) { · {{ 'fields: {fields}' | t: 'staff.texts.row.fields' : { fields: tx.placeholders.join(', ') } }} }</small>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="status-stack">
                    <span class="status-badge" [class.is-active]="tx.enabled" [class.is-inactive]="!tx.enabled">{{ tx.enabled ? ('Shown' | t: 'staff.texts.row.shown') : ('Hidden' | t: 'staff.texts.row.hidden') }}</span>
                    @if (tx.customised && tx.enabled) { <span class="status-badge is-info">{{ 'Changed by Admin' | t: 'staff.texts.row.changed' }}</span> }
                  </div>
                </td>
                <td class="text-nowrap">
                  @if (tx.updatedOn) {
                    <span class="text-nowrap">{{ tx.updatedOn | indianTime }}</span><small class="muted d-block">{{ tx.updatedBy }}</small>
                  } @else {
                    <span class="muted" [title]="'Not changed' | t: 'staff.texts.row.notChangedTooltip'">—</span>
                  }
                </td>
                <td class="text-end">
                  <div class="tx-actions">
                    <button type="button" class="btn btn-outline-primary btn-sm" (click)="edit(tx)">{{ 'Edit' | t: 'staff.texts.row.editButton' }}</button>
                    @if (tx.customised) { <button type="button" class="btn btn-outline-danger btn-sm" (click)="reset(tx)">{{ 'Reset' | t: 'staff.texts.row.resetButton' }}</button> }
                  </div>
                </td>
              </tr>
            } @empty {
              @if (!busy()) { <tr><td colspan="5" style="padding: 0"><div class="no-data">{{ 'No texts found' | t: 'staff.texts.empty' }}</div></td></tr> }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    </div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="textTitle">
        <div class="modal-dialog modal-xl modal-dialog-scrollable editor-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="title-block">
                <div class="modal-title" id="textTitle">{{ e.item.name }}</div>
                <small class="muted">{{ e.item.channel }} · {{ e.item.group }}</small>
              </div>
              <!-- 2026-11-19 (admin audit: status shown twice): the switch below is the one indicator, no badge here. -->
              <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.texts.editor.closeAria'" (click)="editing.set(null)"></button>
            </div>
            <div class="modal-body editor-body">
              <div class="switch-row" [class.off]="!e.enabled">
                <div class="form-check form-switch">
                  <input class="form-check-input" type="checkbox" role="switch" id="textEnabled" [(ngModel)]="e.enabled" />
                  <label class="form-check-label" for="textEnabled">{{ e.enabled ? ('This text is shown' | t: 'staff.texts.editor.shown') : ('This text is hidden' | t: 'staff.texts.editor.hidden') }}</label>
                </div>
              </div>
              @if (e.item.placeholders.length) {
                <div class="fields" role="group" aria-labelledby="textFields">
                  <div class="ed-label" id="textFields">{{ 'Fields' | t: 'staff.texts.editor.fields.label' }} <small class="muted fw-normal">{{ '— click one to put it at the cursor in the text' | t: 'staff.texts.editor.fields.note' }}</small></div>
                  <div class="chips">
                    @for (p of e.item.placeholders; track p) {
                      <button type="button" class="chip" [title]="'Filled in with {field}' | t: 'staff.texts.editor.fields.chipTooltip' : { field: p }" (mousedown)="$event.preventDefault()" (click)="insert(e, p)">{{ braces(p) }}</button>
                    }
                  </div>
                  <small class="muted d-block">{{ 'A field is filled in where the text is shown.' | t: 'staff.texts.editor.fields.text' }}</small>
                </div>
              }
              <div class="editor">
                <div class="pane">
                  <div class="pane-head">
                    <label class="ed-label" for="textBody">{{ 'Text (HTML)' | t: 'staff.texts.editor.body.label' }}</label>
                    <div class="pane-tools">
                      <span class="std-badge" [class.differs]="!isStandard(e)">{{ isStandard(e) ? ('Standard text' | t: 'staff.texts.editor.standard.chip.same') : ('Differs from the standard' | t: 'staff.texts.editor.standard.chip.differs') }}</span>
                      <button type="button" class="btn btn-link btn-sm p-0" (click)="useStandard(e)">{{ 'Use the standard text' | t: 'staff.texts.editor.useStandardButton' }}</button>
                    </div>
                  </div>
                  <textarea #bodyBox class="form-control font-monospace code" id="textBody" spellcheck="false" autocomplete="off"
                            [(ngModel)]="e.body" (ngModelChange)="preview.set($event)" (focus)="placed = true"></textarea>
                </div>
                <div class="pane">
                  <div class="pane-head">
                    <span class="ed-label">{{ 'Preview' | t: 'staff.texts.editor.preview.label' }}</span>
                    <div class="seg" role="group" [attr.aria-label]="'Preview width' | t: 'staff.texts.editor.preview.widthAria'">
                      <button type="button" [class.active]="!phone()" [attr.aria-pressed]="!phone()" (click)="phone.set(false)">{{ 'Desktop' | t: 'staff.texts.editor.preview.desktopButton' }}</button>
                      <button type="button" [class.active]="phone()" [attr.aria-pressed]="phone()" (click)="phone.set(true)">{{ 'Phone' | t: 'staff.texts.editor.preview.phoneButton' }}</button>
                    </div>
                  </div>
                  <div class="page-frame" [class.phone]="phone()">
                    <div class="frame-bar" aria-hidden="true"><i></i><i></i><i></i><span>{{ e.item.channel === 'Website' ? ('Website page' | t: 'staff.texts.editor.preview.websiteFrame') : ('App screen' | t: 'staff.texts.editor.preview.appFrame') }}</span></div>
                    <div class="preview" [innerHTML]="previewHtml()"></div>
                  </div>
                  @if (e.item.placeholders.length) {<small class="muted d-block mt-1">{{ 'Fields shown with sample values.' | t: 'staff.texts.editor.preview.note' }}</small>}
                </div>
              </div>
              @if (modalError()) { <div class="alert alert-danger mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.texts.editor.cancelButton' }}</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="save(e)">{{ 'Save' | t: 'staff.texts.editor.saveButton' }}</button>
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
    .tx-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-value.is-shown { color: #1e7a3c; }
    .stat-value.is-off { color: #8a9899; }
    .stat-label { font-size: 13px; color: #5f6f70; }

    .list-card { padding: 16px; }
    .tx-tabs { display: flex; gap: 4px; border-bottom: 1px solid #dfe9ea; margin: -4px 0 14px; }
    .tx-kinds { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid #dfe9ea; }
    .tx-kind { border: 0; background: none; padding: 9px 18px; font-weight: 700; font-size: 14px; color: #5f6f70; border-bottom: 3px solid transparent; margin-bottom: -1px; cursor: pointer; }
    .tx-kind.active { color: #23474a; border-bottom-color: var(--zt-dark, #24666b); }
    .tx-tab { border: 0; background: none; padding: 8px 16px; font-weight: 600; font-size: 14px; color: #5f6f70; border-bottom: 3px solid transparent; margin-bottom: -1px; cursor: pointer; }
    .tx-tab:hover { color: var(--zt-mid2, #2f7c83); }
    .tx-tab.active { color: #23474a; border-bottom-color: #45a5ad; }
    .list-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .list-toolbar .search { flex: 1 1 260px; max-width: 420px; }

    .tx-table { min-width: 720px; margin-bottom: 8px; }
    .tx-table td { vertical-align: middle; }
    .tx-table tbody tr:hover { background: var(--zt-pale, #f7fbfb); }
    .tx-table tr.is-off .tx-text strong { color: #8a9899; }
    .col-sno { width: 64px; }
    .col-status { width: 170px; }
    .col-change { width: 170px; }
    .col-action { width: 150px; }
    .tx-actions { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: nowrap; white-space: nowrap; }
    .tx-actions > * { flex: none; }
    .tx { display: flex; gap: 12px; align-items: center; }
    .tx-icon { flex: 0 0 38px; height: 34px; border-radius: 10px; background: #eef6f6; color: var(--zt-mid2, #2f7c83); display: grid; place-items: center; font-size: 11px; font-weight: 800; letter-spacing: .04em; }
    .tx-icon.app { background: #f1f0fb; color: #3f3a7a; }
    .tx-text { min-width: 0; }
    .tx-text strong { color: #232527; }
    .tx-text small { margin-top: 2px; overflow-wrap: break-word; }
    .status-stack { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }

    /* Editor pop-up: wide, the full height, the header and footer fixed and the body scrolling. */
    @media (min-width: 576px) { .modal-dialog.editor-dialog { max-width: min(1180px, calc(100vw - 32px)); } }
    .editor-dialog .modal-content { height: 100%; }
    .modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .title-block { min-width: 0; }
    .title-block .muted { display: block; margin-top: 2px; font-size: 13px; }
    .editor-body { display: flex; flex-direction: column; gap: 16px; }
    .ed-label { display: block; margin: 0; font-size: 14px; font-weight: 600; color: #23474a; text-transform: none; }
    .fields .ed-label { margin-bottom: 6px; }
    .switch-row { padding: 10px 14px; background: #eef6f6; border: 1px solid #dfe9ea; border-radius: 10px; }
    .switch-row.off { background: #f6f7f7; border-color: #e3e7e8; }
    .switch-row .form-check { display: flex; align-items: center; gap: 10px; min-height: 0; margin: 0; padding: 0; }
    .switch-row .form-check-input { float: none; flex: 0 0 auto; width: 2.4em; height: 1.3em; margin: 0; cursor: pointer; }
    .switch-row .form-check-label { margin: 0; font-weight: 600; color: #23474a; text-transform: none; cursor: pointer; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .chip { padding: 3px 10px; border: 1px solid #cfe3e5; border-radius: 12px; background: #eef6f6; color: #23474a; cursor: pointer;
      font: 600 12px/1.5 SFMono-Regular, Consolas, 'Liberation Mono', monospace; }
    .chip:hover { background: #dff0f1; border-color: #45a5ad; }
    .chip:focus-visible { outline: 2px solid #45a5ad; outline-offset: 2px; }
    .editor { flex: 1 0 auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
    @media (min-width: 992px) { .editor { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
    .pane { display: flex; flex-direction: column; min-width: 0; }
    .pane-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; margin-bottom: 6px; }
    .pane-tools { display: flex; align-items: center; gap: 10px; }
    .std-badge { font-size: 11px; font-weight: 700; border-radius: 10px; padding: 1px 8px; background: #eef6f6; color: var(--zt-mid2, #2f7c83); }
    .std-badge.differs { background: #fff4d6; color: #8a6100; }
    .editor textarea.form-control.code { flex: 1 1 auto; width: 100%; max-width: 100%; min-height: 440px; resize: vertical;
      padding: 10px 12px; font-size: 12.5px; line-height: 1.55; tab-size: 2; background: #1f2a2b; color: #e6f1f1; border-color: #1f2a2b; border-radius: 8px; }
    .editor textarea.form-control.code:focus { box-shadow: 0 0 0 3px rgba(69, 165, 173, .35); }
    /* The preview inside a page (or phone) frame. */
    .page-frame { flex: 1 1 auto; display: flex; flex-direction: column; margin: 0 auto; width: 100%; border: 1px solid #dfe9ea; border-radius: 8px; overflow: hidden; background: #fff; }
    .page-frame.phone { max-width: 390px; border: 6px solid #2a3435; border-radius: 18px; }
    .frame-bar { display: flex; align-items: center; gap: 5px; padding: 6px 10px; background: #f1f4f4; border-bottom: 1px solid #dfe9ea; font-size: 11px; color: #5f6f70; }
    .frame-bar i { width: 8px; height: 8px; border-radius: 4px; background: #cfd8d9; }
    .frame-bar span { margin-left: 6px; }
    .preview { flex: 1 1 auto; min-height: 400px; background: #fff; padding: 14px 16px; overflow: auto; overflow-wrap: break-word; }
    @media (max-width: 991.98px) { .editor textarea.form-control.code, .preview { min-height: 340px; } }
    /* Phone: one card per text, no sideways scroll. */
    @media (max-width: 767.98px) {
      .tx-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .list-card { padding: 12px; }
      .tx-table { min-width: 0; }
      .tx-table thead { display: none; }
      .tx-table, .tx-table tbody, .tx-table tr, .tx-table td { display: block; width: 100%; }
      .tx-table tr { border: 1px solid #dfe9ea; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; }
      .tx-table td { border: 0; padding: 4px 0; text-align: left !important; }
      .tx-table td:first-child { display: none; }
      .tx-actions { justify-content: flex-start; }
      .status-stack { flex-direction: row; flex-wrap: wrap; }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class TextsPage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private static readonly url = '/api/staff/settings/texts';
  /** {{PublicBaseUrl}} in the preview. */
  private readonly baseUrl = portalBaseUrl(inject(DOCUMENT));
  private readonly bodyBox = viewChild<ElementRef<HTMLTextAreaElement>>('bodyBox');
  /** Messages and documents (the HTML texts) or the pages' wording. */
  protected readonly kind = signal<'texts' | 'wording'>('texts');
  private readonly wordingPanel = viewChild(PageTextsPanel);

  protected readonly channels = ['Website', 'Mobile app'];
  protected readonly items = signal<TextItem[]>([]);
  protected readonly channel = signal('Website');
  protected readonly search = signal('');
  protected readonly filters = computed<readonly { key: StatusFilter; label: string }[]>(() => [
    { key: 'all', label: t('staff.texts.filter.all', 'All') },
    { key: 'shown', label: t('staff.texts.filter.shown', 'Shown') },
    { key: 'hidden', label: t('staff.texts.filter.hidden', 'Hidden') },
    { key: 'changed', label: t('staff.texts.filter.changed', 'Changed') },
  ]);
  protected readonly filter = signal<StatusFilter>('all');
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filter();
    return this.items().filter((x) => x.channel === this.channel()
      && (f === 'all' || (f === 'shown' && x.enabled) || (f === 'hidden' && !x.enabled) || (f === 'changed' && x.customised))
      && (!q || `${x.name} ${x.group}`.toLowerCase().includes(q)));
  });
  /** The counts of the tab shown. */
  protected readonly stats = computed(() => {
    const rows = this.items().filter((x) => x.channel === this.channel());
    return { total: rows.length, shown: rows.filter((x) => x.enabled).length, hidden: rows.filter((x) => !x.enabled).length, changed: rows.filter((x) => x.customised).length };
  });
  /** The preview at a phone's width (first for the apps' texts). */
  protected readonly phone = signal(false);
  protected readonly view = new PagedView(this.shown);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly preview = signal('');
  /** The preview with the fields filled with sample values (the saved text keeps them); Angular's sanitizer cleans it as it does the pages. */
  protected readonly previewHtml = computed(() => fillSampleFields(this.preview(), this.baseUrl));
  /** Whether the Admin has been in the text since it was loaded or replaced (else a field goes at its end). */
  protected placed = false;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');

  constructor() {
    void this.load();
  }

  protected count(channel: string): number {
    return this.items().filter((x) => x.channel === channel).length;
  }

  protected braces(name: string): string {
    return `{{${name}}}`;
  }

  protected async edit(item: TextItem): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    this.modalError.set('');
    try {
      const d = await firstValueFrom(this.http.get<TextDetails>(`${TextsPage.url}/${encodeURIComponent(item.key)}`));
      this.editing.set({ item: d.item, enabled: d.item.enabled, body: d.bodyHtml, standard: d.standardHtml });
      this.phone.set(d.item.channel !== 'Website');
      this.preview.set(d.bodyHtml);
      this.placed = false;
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Puts the field at the text's cursor (in place of a selection), or at its end when the Admin has not been in it yet. */
  protected insert(e: Editing, name: string): void {
    const box = this.bodyBox()?.nativeElement ?? null;
    const { value, caret } = insertAtCursor(e.body, this.braces(name), this.placed ? box : null);
    e.body = value;
    this.preview.set(value);
    if (box) {
      box.value = value;
      box.focus();
      box.setSelectionRange(caret, caret);
    }
  }

  /** Whether the text is the standard one (spaces at the ends aside). */
  protected isStandard(e: Editing): boolean {
    return e.body.trim() === e.standard.trim();
  }

  protected useStandard(e: Editing): void {
    e.body = e.standard;
    this.preview.set(e.body);
    this.placed = false;
  }

  protected async save(e: Editing): Promise<void> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      const r = await firstValueFrom(
        this.http.put<MessageResponse>(`${TextsPage.url}/${encodeURIComponent(e.item.key)}`, { enabled: e.enabled, bodyHtml: e.body.trim() || null }),
      );
      this.editing.set(null);
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async reset(item: TextItem): Promise<void> {
    const ok = await this.confirms.ask({
      title: t('staff.texts.resetDialog.title', 'Reset to the Standard Text?'),
      message: t('staff.texts.resetDialog.message', '"{name}" shows the standard text again. The saved text is removed.', { name: item.name }),
      confirmLabel: t('staff.texts.resetDialog.confirmButton', 'Reset'), danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.delete<MessageResponse>(`${TextsPage.url}/${encodeURIComponent(item.key)}`));
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected reload(): void {
    this.wordingPanel()?.reload();
    this.editing.set(null);
    this.error.set('');
    this.success.set('');
    this.items.set([]);
    void this.load();
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      this.items.set(await firstValueFrom(this.http.get<TextItem[]>(TextsPage.url)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
