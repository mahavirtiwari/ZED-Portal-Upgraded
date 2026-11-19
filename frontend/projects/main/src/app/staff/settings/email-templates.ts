import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DOCUMENT, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { PortalSwitchComponent } from '../admin-portal';
import { ConfirmService } from '../confirm-dialog';
import { IndianTimePipe } from '../utc-time';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PagedView, PagerComponent } from '../pager';

export interface EmailTemplateItem {
  key: string;
  name: string;
  group: string;
  /** Sent by a database procedure (through the jobs service). */
  database: boolean;
  enabled: boolean;
  /** The Admin saved something for it (switched off, own subject or own text). */
  customised: boolean;
  subject: string | null;
  placeholders: string[];
  updatedBy: string | null;
  updatedOn: string | null;
}

interface EmailTemplateDetails {
  item: EmailTemplateItem;
  bodyHtml: string;
  /** The body is the standard e-mail (nothing of the Admin's saved). */
  standardBody: boolean;
  /** Database mails: the procedure's last mail (2026-11-08), what {{StandardBody}} looks like. */
  example?: { subject: string | null; bodyHtml: string | null; createdAt: string | null } | null;
}

interface Editing {
  item: EmailTemplateItem;
  enabled: boolean;
  subject: string;
  body: string;
  standardBody: boolean;
  example?: EmailTemplateDetails['example'];
}

/** A {{Field}} as the server reads it (EmailPlaceholders in Zed.Core): spaces allowed inside the braces. */
const fieldPattern = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * This portal's address as the mails' {{PublicBaseUrl}} has it: the origin and the base href (e.g. /Consultancy), without
 * a trailing slash.
 */
export function portalBaseUrl(doc: Document): string {
  try {
    const u = new URL(doc.baseURI);
    if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.origin}${u.pathname.replace(/[^/]*$/, '')}`.replace(/\/+$/, '');
  } catch {
    // not a web address (tests, about:blank): the page's origin below
  }
  return doc.location?.origin ?? '';
}

/**
 * The text with its {{Fields}} filled for the preview only: {{PublicBaseUrl}} with this portal's address (so images and
 * links open), a field in `raw` with its HTML, any other with its name in brackets. What is saved keeps the fields.
 */
export function fillSampleFields(text: string, baseUrl: string, raw: Readonly<Record<string, string>> = {}): string {
  return text.replace(fieldPattern, (_match, name: string) => {
    const key = name.toLowerCase();
    if (key === 'publicbaseurl') return escapeHtml(baseUrl);
    const own = Object.keys(raw).find((k) => k.toLowerCase() === key);
    return own !== undefined ? raw[own] : `[${name}]`;
  });
}

/**
 * `snippet` in place of the box's selection, or at the end when `box` is null (the Admin has not put the cursor there);
 * the new text and the cursor position after the snippet.
 */
export function insertAtCursor(text: string, snippet: string, box: HTMLInputElement | HTMLTextAreaElement | null): { value: string; caret: number } {
  let start = text.length;
  let end = text.length;
  if (box && box.value === text && box.selectionStart !== null) {
    start = box.selectionStart;
    end = Math.max(start, box.selectionEnd ?? start);
  }
  return { value: text.slice(0, start) + snippet + text.slice(end), caret: start + snippet.length };
}

/** {{StandardBody}} in the preview: where the standard e-mail's text goes (it is not loaded with an own text). */
/** Which e-mails the list shows (the buttons beside the search box). */
type StatusFilter = 'all' | 'sent' | 'off' | 'changed';

const standardBodySample =
  '<div style="margin:8px 0;padding:14px 16px;border:1px dashed #9ccdd1;border-radius:8px;background:var(--zt-pale, #f7fbfb);color:#5f6f70;font:14px/1.5 sans-serif">' +
  "The standard e-mail's text is put here.</div>";

/**
 * Admin → Email Templates (new in V4): every e-mail of this portal and of its database procedures. An Admin can switch an
 * e-mail off, give it an own subject and HTML text with {{Placeholder}} fields, or reset it to the standard e-mail.
 * V4 layout: the counts, the portal / database tabs, search and a status filter, each e-mail with its group and subject;
 * the editor pop-up has the HTML beside its preview as a mail (the subject line on top, desktop or phone width, fields
 * filled with sample values), and field chips that put a field at the cursor.
 */
@Component({
  selector: 'zed-staff-email-templates',
  imports: [DatePipe, IndianTimePipe, FormsModule, PagerComponent, PortalSwitchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Email Templates</h3>
        <p class="page-sub">The e-mails of this portal and of its database procedures: switch one off, change its subject and text, or reset it.</p>
      </div>
    </div>
    <!-- One Admin (V4): the portal whose settings these are (each portal keeps its own). -->
    <zed-portal-switch />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="et-stats">
      <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">E-mails</span></div>
      <div class="stat"><span class="stat-value is-sent">{{ stats().sent }}</span><span class="stat-label">Sent</span></div>
      <div class="stat"><span class="stat-value is-off">{{ stats().off }}</span><span class="stat-label">Switched off</span></div>
      <div class="stat"><span class="stat-value">{{ stats().changed }}</span><span class="stat-label">Changed by Admin</span></div>
    </div>

    <div class="zed-card list-card">
      <div class="et-tabs" role="tablist">
        @for (t of tabs; track t.database) {
          <button type="button" role="tab" class="et-tab" [class.active]="database() === t.database" [attr.aria-selected]="database() === t.database"
                  (click)="database.set(t.database)">{{ t.label }} ({{ count(t.database) }})</button>
        }
      </div>
      <div class="list-toolbar">
        <input type="search" class="form-control search" placeholder="Search e-mail, group or subject" aria-label="Search e-mails" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        <div class="seg" role="group" aria-label="Show">
          @for (f of filters; track f.key) {
            <button type="button" [class.active]="filter() === f.key" [attr.aria-pressed]="filter() === f.key" (click)="filter.set(f.key)">{{ f.label }}</button>
          }
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-zed et-table">
          <thead>
            <tr>
              <th class="text-center col-sno">S.No</th>
              <th>E-mail</th>
              <th class="col-status">Status</th>
              <th class="col-change">Last change</th>
              <th class="text-end col-action">Action</th>
            </tr>
          </thead>
          <tbody>
            @for (t of view.page(); track t.key) {
              <tr [class.is-off]="!t.enabled">
                <td class="text-center">{{ view.serial($index) }}</td>
                <td>
                  <div class="mail">
                    <span class="mail-icon" [class.db]="t.database" aria-hidden="true">{{ t.database ? 'DB' : '✉' }}</span>
                    <div class="mail-text">
                      <div class="mail-title">
                        <strong>{{ t.name }}</strong>
                        @if (!t.database) { <span class="group-chip">{{ t.group }}</span> }
                      </div>
                      @if (t.subject) {<small class="muted d-block subject">Subject: {{ t.subject }}</small>}
                      @else {<small class="muted d-block subject">Standard subject</small>}
                    </div>
                  </div>
                </td>
                <td>
                  <!-- 2026-11-19 (admin audit: status shown twice): the switch is the one status indicator, labelled Sent / Switched off. -->
                  <div class="status-stack">
                    <label class="quick-switch" [class.off]="!t.enabled" [title]="t.enabled ? 'Switch this e-mail off' : 'Switch this e-mail on'">
                      <input type="checkbox" role="switch" [checked]="t.enabled" [attr.aria-label]="(t.enabled ? 'Switch off ' : 'Switch on ') + t.name"
                             (click)="$event.preventDefault(); toggle(t)" />
                      <span class="qs-track" aria-hidden="true"></span>{{ t.enabled ? 'Sent' : 'Switched off' }}
                    </label>
                    @if (t.customised && t.enabled) {<span class="status-badge is-info">Changed by Admin</span>}
                  </div>
                </td>
                <td class="col-change-cell">
                  @if (t.updatedOn) {
                    <span class="text-nowrap">{{ t.updatedOn | indianTime }}</span><small class="muted d-block">{{ t.updatedBy }}</small>
                  } @else {
                    <span class="muted" title="Not changed">—</span>
                  }
                </td>
                <td class="text-end">
                  <div class="et-actions">
                    <button type="button" class="btn btn-outline-primary btn-sm" (click)="edit(t)">Edit</button>
                    @if (t.customised) {
                      <button type="button" class="btn btn-outline-danger btn-sm" (click)="reset(t)">Reset</button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              @if (!busy()) { <tr><td colspan="5" style="padding: 0"><div class="no-data">No e-mails found</div></td></tr> }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    </div>

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="templateTitle">
        <!-- 2026-11-15 (design approved): the switch in the title bar, subject and fields in one strip, the HTML and the
             preview side by side filling the pop-up (each scrolls on its own), a fixed bar with Reset / Cancel / Save. -->
        <div class="modal-dialog modal-xl editor-dialog">
          <div class="modal-content ed-content">
            <div class="modal-header ed-head">
              <div class="title-block">
                <div class="modal-title" id="templateTitle">{{ e.item.name }}</div>
                <small>{{ e.item.database ? 'Database mail' : 'Portal mail' }} · {{ e.item.group }}</small>
              </div>
              <div class="head-right">
                <label class="head-switch" [class.off]="!e.enabled" for="templateEnabled">
                  <input class="form-check-input" type="checkbox" role="switch" id="templateEnabled" [(ngModel)]="e.enabled" />
                  <span>{{ e.enabled ? 'Sent (switch off to stop it)' : 'Switched off (not sent)' }}</span>
                </label>
                <button type="button" class="btn-close" aria-label="Close" (click)="editing.set(null)"></button>
              </div>
            </div>
            <div class="ed-strip">
              <div class="ed-subject">
                <label class="ed-label" for="templateSubject">Subject</label>
                <input #subjectBox type="text" class="form-control" id="templateSubject" maxlength="400" autocomplete="off" placeholder="Empty: the standard subject"
                       [(ngModel)]="e.subject" (focus)="focused('subject')" />
              </div>
              <div class="fields" role="group" aria-labelledby="templateFields">
                <div class="ed-label" id="templateFields">Fields <small class="muted fw-normal">: click one to put it at the cursor (in the subject when you were typing there)</small></div>
                <div class="chips">
                  @for (p of e.item.placeholders; track p) {
                    <button type="button" class="chip" [title]="hint(p)" (mousedown)="$event.preventDefault()" (click)="insert(p)">{{ braces(p) }}</button>
                  }
                </div>
              </div>
            </div>
            <div class="modal-body ed-body">
              <div class="editor">
                <div class="pane">
                  <div class="pane-head">
                    <label class="ed-label" for="templateBody">Text (HTML)</label>
                    @if (e.standardBody) {<small class="muted">the standard e-mail</small>}
                  </div>
                  <textarea #bodyBox class="form-control font-monospace code" id="templateBody" spellcheck="false" autocomplete="off"
                            [(ngModel)]="e.body" (ngModelChange)="preview.set($event)" (focus)="focused('body')"></textarea>
                </div>
                <div class="pane">
                  <div class="pane-head">
                    <span class="ed-label">Preview</span>
                    <div class="seg" role="group" aria-label="Preview width">
                      <button type="button" [class.active]="!phone()" [attr.aria-pressed]="!phone()" (click)="phone.set(false)">Desktop</button>
                      <button type="button" [class.active]="phone()" [attr.aria-pressed]="phone()" (click)="phone.set(true)">Phone</button>
                    </div>
                  </div>
                  <div class="preview-well">
                    <div class="mail-frame" [class.phone]="phone()">
                      <div class="mail-meta">
                        <span class="meta-label">Subject</span>
                        <span class="meta-subject">{{ subjectPreview(e) }}</span>
                      </div>
                      <iframe class="preview" title="E-mail preview" sandbox="" [attr.srcdoc]="previewHtml()"></iframe>
                    </div>
                  </div>
                </div>
              </div>
              <small class="muted d-block ed-note">
                A field is filled in when the e-mail is sent ({{ braces('StandardBody') }} is the standard e-mail's text, {{ braces('StandardSubject') }} its subject);
                the preview shows sample values: [Name] stands for the unit's value.
                @if (e.item.database) {
                  <span data-db-example>
                    @if (e.example?.createdAt) { {{ braces('StandardBody') }} shows the procedure's last mail, of {{ e.example!.createdAt | date: 'dd-MM-yyyy HH:mm' }}. }
                    @else { This procedure has sent no mail yet, so {{ braces('StandardBody') }} is shown as a box. }
                    {{ braces('To') }} is the recipient and {{ braces('ZedId') }} the ZED ID the mail names.
                  </span>
                }
              </small>
              @if (modalError()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer ed-foot">
              <span>
                @if (e.item.customised) {
                  <button type="button" class="btn btn-outline-danger" (click)="resetFromEditor(e)">Reset to standard</button>
                }
              </span>
              <span class="ed-foot-actions">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">Cancel</button>
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="save(e)">Save</button>
              </span>
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
  styleUrl: './email-templates-dialog.scss',
  styles: `
    .et-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-value.is-sent { color: #1e7a3c; }
    .stat-value.is-off { color: #8a9899; }
    .stat-label { font-size: 13px; color: #5f6f70; }

    .list-card { padding: 16px; }
    .et-tabs { display: flex; gap: 4px; border-bottom: 1px solid #dfe9ea; margin: -4px 0 14px; }
    .et-tab { border: 0; background: none; padding: 8px 16px; font-weight: 600; font-size: 14px; color: #5f6f70; border-bottom: 3px solid transparent; margin-bottom: -1px; cursor: pointer; }
    .et-tab:hover { color: var(--zt-mid2, #2f7c83); }
    .et-tab.active { color: #23474a; border-bottom-color: #45a5ad; }
    .list-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .list-toolbar .search { flex: 1 1 260px; max-width: 420px; }

    .et-table { min-width: 760px; margin-bottom: 8px; }
    .et-table td { vertical-align: middle; }
    .et-table tbody tr:hover { background: var(--zt-pale, #f7fbfb); }
    .et-table tr.is-off .mail-text strong { color: #8a9899; }
    .col-sno { width: 64px; }
    .col-status { width: 190px; }
    .col-change { width: 170px; }
    .col-action { width: 150px; }
    .col-change-cell { white-space: nowrap; }
    .et-actions { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: nowrap; white-space: nowrap; }
    .et-actions > * { flex: none; }
    .mail { display: flex; gap: 12px; align-items: flex-start; }
    .mail-icon { flex: 0 0 34px; height: 34px; border-radius: 10px; background: #eef6f6; color: var(--zt-mid2, #2f7c83); display: grid; place-items: center; font-size: 16px; font-weight: 700; }
    .mail-icon.db { background: #f1f0fb; color: #3f3a7a; font-size: 11px; }
    .mail-text { min-width: 0; }
    .mail-title { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
    .mail-text strong { color: #232527; }
    .group-chip { display: inline-block; font-size: 11px; font-weight: 600; background: #eef6f6; color: #23474a; border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
    .subject { margin-top: 2px; overflow-wrap: break-word; }
    .status-stack { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }

    /* The on / off switch of a row. */
    /* position: relative keeps the hidden input inside the table's scroll box (it widened the page on phones). */
    .quick-switch { position: relative; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 12.5px; font-weight: 600; color: #1e7a3c; cursor: pointer; text-transform: none; }
    .quick-switch.off { color: #8a9899; }
    .quick-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .qs-track { position: relative; width: 30px; height: 16px; border-radius: 9px; background: #45a5ad; transition: background .15s; flex: none; }
    .qs-track::after { content: ''; position: absolute; top: 2px; left: 16px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: left .15s; }
    .quick-switch.off .qs-track { background: #c3cdce; }
    .quick-switch.off .qs-track::after { left: 2px; }
    .quick-switch input:focus-visible + .qs-track { outline: 2px solid var(--zt-dark, #23656b); outline-offset: 2px; }
    /* Phone: one card per e-mail, no sideways scroll. */
    @media (max-width: 767.98px) {
      .et-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .list-card { padding: 12px; }
      .et-table { min-width: 0; }
      .et-table thead { display: none; }
      .et-table, .et-table tbody, .et-table tr, .et-table td { display: block; width: 100%; }
      .et-table tr { border: 1px solid #dfe9ea; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; }
      .et-table td { border: 0; padding: 4px 0; text-align: left !important; }
      .et-table td:first-child { display: none; }
      .et-actions { justify-content: flex-start; }
      .status-stack { flex-direction: row; flex-wrap: wrap; align-items: center; }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class EmailTemplatesPage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private readonly sanitizer = inject(DomSanitizer);
  private static readonly url = '/api/staff/settings/email-templates';
  /** {{PublicBaseUrl}} in the preview. */
  private readonly baseUrl = portalBaseUrl(inject(DOCUMENT));
  private readonly subjectBox = viewChild<ElementRef<HTMLInputElement>>('subjectBox');
  private readonly bodyBox = viewChild<ElementRef<HTMLTextAreaElement>>('bodyBox');

  protected readonly tabs = [
    { label: 'Portal mails', database: false },
    { label: 'Database mails', database: true },
  ];
  protected readonly items = signal<EmailTemplateItem[]>([]);
  protected readonly database = signal(false);
  protected readonly search = signal('');
  protected readonly filters: readonly { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'sent', label: 'Sent' },
    { key: 'off', label: 'Switched off' },
    { key: 'changed', label: 'Changed' },
  ];
  protected readonly filter = signal<StatusFilter>('all');
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filter();
    return this.items().filter((t) => t.database === this.database()
      && (f === 'all' || (f === 'sent' && t.enabled) || (f === 'off' && !t.enabled) || (f === 'changed' && t.customised))
      && (!q || `${t.name} ${t.group} ${t.subject ?? ''}`.toLowerCase().includes(q)));
  });
  /** The counts of the tab shown. */
  protected readonly stats = computed(() => {
    const rows = this.items().filter((t) => t.database === this.database());
    return { total: rows.length, sent: rows.filter((t) => t.enabled).length, off: rows.filter((t) => !t.enabled).length, changed: rows.filter((t) => t.customised).length };
  });
  /** The preview at a phone's width. */
  protected readonly phone = signal(false);
  protected readonly view = new PagedView(this.shown);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly preview = signal('');
  /**
   * The preview with the fields filled with sample values (the saved text keeps them). Nothing is sent or run: the frame
   * is sandboxed.
   */
  protected readonly previewHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      fillSampleFields(this.preview(), this.baseUrl, { StandardBody: this.editing()?.example?.bodyHtml || standardBodySample }),
    ),
  );
  /** Where a field chip goes: the subject or the text, whichever was last in focus. */
  protected target: 'subject' | 'body' = 'body';
  /** Whether the Admin has been in the subject / the text since it was loaded (else a field goes at its end). */
  private placed = { subject: false, body: false };
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');

  constructor() {
    void this.load();
  }

  protected count(database: boolean): number {
    return this.items().filter((t) => t.database === database).length;
  }

  protected braces(name: string): string {
    return `{{${name}}}`;
  }

  protected hint(name: string): string {
    if (name === 'StandardBody') return "The standard e-mail's text";
    if (name === 'StandardSubject') return "The standard e-mail's subject";
    return `Filled in with ${name}`;
  }

  /** The subject line of the preview: the Admin's (fields with sample values) or the standard one. */
  protected subjectPreview(e: Editing): string {
    const subject = e.subject.trim();
    if (!subject) return "The standard e-mail's subject";
    return subject.replace(fieldPattern, (_m, name: string) => (name.toLowerCase() === 'standardsubject' ? '[the standard subject]' : `[${name}]`));
  }

  protected focused(target: 'subject' | 'body'): void {
    this.target = target;
    this.placed[target] = true;
  }

  protected async edit(item: EmailTemplateItem): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    this.modalError.set('');
    try {
      const d = await firstValueFrom(this.http.get<EmailTemplateDetails>(`${EmailTemplatesPage.url}/${encodeURIComponent(item.key)}`));
      this.editing.set({ item: d.item, enabled: d.item.enabled, subject: d.item.subject ?? '', body: d.bodyHtml, standardBody: d.standardBody, example: d.example ?? null });
      this.preview.set(d.bodyHtml);
      this.target = 'body';
      this.placed = { subject: false, body: false };
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Puts the field at the cursor of the subject or the text, whichever was last in focus (in place of a selection), or at
   * its end when the Admin has not been in it yet; the cursor then stands after the field.
   */
  protected insert(name: string): void {
    const e = this.editing();
    if (!e) return;
    const subject = this.target === 'subject';
    const box = (subject ? this.subjectBox() : this.bodyBox())?.nativeElement ?? null;
    const { value, caret } = insertAtCursor(subject ? e.subject : e.body, this.braces(name), this.placed[this.target] ? box : null);
    if (subject) e.subject = value;
    else {
      e.body = value;
      this.preview.set(value);
    }
    if (box) {
      box.value = value;
      box.focus();
      box.setSelectionRange(caret, caret);
    }
  }

  protected async save(e: Editing): Promise<void> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      const r = await firstValueFrom(
        this.http.put<MessageResponse>(`${EmailTemplatesPage.url}/${encodeURIComponent(e.item.key)}`, {
          enabled: e.enabled,
          subject: e.subject.trim() || null,
          bodyHtml: e.body.trim() || null,
        }),
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

  /** The list's switch: on or off, the saved subject and text kept (read first, then saved with only the switch changed). */
  protected async toggle(item: EmailTemplateItem): Promise<void> {
    const on = !item.enabled;
    if (!on && !(await this.confirms.ask({
      title: 'Switch This E-mail Off?', message: `"${item.name}" is no longer sent until it is switched on again.`, confirmLabel: 'Switch Off', danger: true,
    }))) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const d = await firstValueFrom(this.http.get<EmailTemplateDetails>(`${EmailTemplatesPage.url}/${encodeURIComponent(item.key)}`));
      const r = await firstValueFrom(
        this.http.put<MessageResponse>(`${EmailTemplatesPage.url}/${encodeURIComponent(item.key)}`, {
          enabled: on,
          subject: d.item.subject?.trim() || null,
          bodyHtml: d.standardBody ? null : d.bodyHtml,
        }),
      );
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private askReset(item: EmailTemplateItem): Promise<boolean> {
    return this.confirms.ask({
      title: 'Reset to the Standard E-mail?', message: `"${item.name}" uses the standard e-mail again. The saved subject and text are removed.`,
      confirmLabel: 'Reset', danger: true,
    });
  }

  /** "Reset to standard" in the pop-up: as the list's Reset, then the pop-up closes. */
  protected async resetFromEditor(e: Editing): Promise<void> {
    if (!(await this.askReset(e.item))) return;
    this.editing.set(null);
    await this.reset(e.item, false);
  }

  protected async reset(item: EmailTemplateItem, ask = true): Promise<void> {
    if (ask && !(await this.askReset(item))) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.delete<MessageResponse>(`${EmailTemplatesPage.url}/${encodeURIComponent(item.key)}`));
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
      this.items.set(await firstValueFrom(this.http.get<EmailTemplateItem[]>(EmailTemplatesPage.url)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
