import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
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
}

interface Editing {
  item: EmailTemplateItem;
  enabled: boolean;
  subject: string;
  body: string;
  standardBody: boolean;
}

/**
 * Admin → Email Templates (new in V4): every e-mail of this portal and of its database procedures. An Admin can switch an
 * e-mail off, give it an own subject and HTML text with {{Placeholder}} fields, or reset it to the standard e-mail.
 * V4 layout: page head, search in a filter bar, status badges and row buttons side by side.
 */
@Component({
  selector: 'zed-staff-email-templates',
  imports: [DatePipe, FormsModule, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Email Templates</h3>
        <p class="page-sub">Every e-mail of this portal and of its database procedures: switch one off, change its subject and text, or reset it.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <ul class="nav nav-tabs mb-3" role="tablist">
      @for (t of tabs; track t.database) {
        <li class="nav-item" role="presentation">
          <button type="button" role="tab" class="nav-link" [class.active]="database() === t.database" [attr.aria-selected]="database() === t.database"
                  (click)="database.set(t.database)">{{ t.label }} ({{ count(t.database) }})</button>
        </li>
      }
    </ul>
    <div class="filter-bar mb-3">
      <div class="filter wide">
        <input type="search" class="form-control" placeholder="Search e-mail, group or subject" aria-label="Search e-mails" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 60px">S.No</th><th>E-mail</th>@if (!database()) {<th>Group</th>}<th class="text-center" style="width: 150px">Status</th><th class="text-center" style="width: 150px">Last change</th><th class="text-center" style="width: 150px">Action</th>
          </tr>
        </thead>
        <tbody>
          @for (t of view.page(); track t.key) {
            <tr>
              <td class="text-center">{{ view.serial($index) }}</td>
              <td><strong>{{ t.name }}</strong>@if (t.subject) {<small class="text-muted d-block">Subject: {{ t.subject }}</small>}</td>
              @if (!database()) {<td>{{ t.group }}</td>}
              <td class="text-center">
                <span class="status-badge" [class.is-active]="t.enabled" [class.is-inactive]="!t.enabled">{{ t.enabled ? 'Sent' : 'Switched off' }}</span>
                @if (t.customised && t.enabled) {<small class="text-muted d-block mt-1">Changed by Admin</small>}
              </td>
              <td class="text-center">@if (t.updatedOn) { {{ t.updatedOn | date: 'dd-MM-yyyy HH:mm' }}<small class="text-muted d-block">{{ t.updatedBy }}</small> }</td>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  <button type="button" class="btn btn-outline-primary" (click)="edit(t)">Edit</button>
                  @if (t.customised) {
                    <button type="button" class="btn btn-default" (click)="reset(t)">Reset</button>
                  }
                </div>
              </td>
            </tr>
          } @empty {
            @if (!busy()) { <tr><td colspan="6" style="padding: 0"><div class="no-data">No e-mails found</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="templateTitle">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="templateTitle"><strong>{{ e.item.name }}</strong></div>
              <button type="button" class="close btn btn-link" aria-label="Close" (click)="editing.set(null)"><strong>x&nbsp;</strong></button>
            </div>
            <div class="modal-body">
              <div class="form-check form-switch mb-3">
                <input class="form-check-input" type="checkbox" role="switch" id="templateEnabled" [(ngModel)]="e.enabled" />
                <label class="form-check-label" for="templateEnabled"><strong>{{ e.enabled ? 'This e-mail is sent' : 'This e-mail is switched off (not sent)' }}</strong></label>
              </div>
              <div class="form-grid mb-3">
                <label for="templateSubject">Subject</label>
                <input type="text" class="form-control" id="templateSubject" maxlength="400" autocomplete="off" placeholder="Empty: the standard subject"
                       [(ngModel)]="e.subject" (focus)="target = 'subject'" />
                <span class="label top">Fields:</span>
                <div>
                  @for (p of e.item.placeholders; track p) {
                    <button type="button" class="btn btn-outline-primary btn-sm me-1 mb-1 chip" [title]="hint(p)" (click)="insert(p)">{{ braces(p) }}</button>
                  }
                  <small class="text-muted d-block">A field is filled in when the e-mail is sent. {{ braces('StandardBody') }} is the standard e-mail's text and {{ braces('StandardSubject') }} its subject.</small>
                </div>
              </div>
              <div class="row g-3">
                <div class="col-lg-6">
                  <label class="form-label" for="templateBody"><strong>Text (HTML)</strong>@if (e.standardBody) { <small class="text-muted">— the standard e-mail</small>}</label>
                  <textarea class="form-control font-monospace body" id="templateBody" spellcheck="false" [(ngModel)]="e.body" (focus)="target = 'body'"
                            (input)="preview.set(e.body)"></textarea>
                </div>
                <div class="col-lg-6">
                  <span class="form-label d-block"><strong>Preview</strong></span>
                  <iframe class="preview" title="E-mail preview" sandbox="" [attr.srcdoc]="previewHtml()"></iframe>
                </div>
              </div>
              @if (modalError()) { <div class="alert alert-danger mt-3" role="alert">{{ modalError() }}</div> }
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
    .body { min-height: 420px; font-size: 12px; }
    .preview { width: 100%; min-height: 420px; border: 1px solid #ced4da; border-radius: 4px; background: #fff; }
    .chip { font-family: monospace; font-size: 12px; }
    .form-grid > .top { align-self: start; padding-top: 6px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class EmailTemplatesPage {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  private static readonly url = '/api/staff/settings/email-templates';

  protected readonly tabs = [
    { label: 'Portal mails', database: false },
    { label: 'Database mails', database: true },
  ];
  protected readonly items = signal<EmailTemplateItem[]>([]);
  protected readonly database = signal(false);
  protected readonly search = signal('');
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.items().filter((t) => t.database === this.database() && (!q || `${t.name} ${t.group} ${t.subject ?? ''}`.toLowerCase().includes(q)));
  });
  protected readonly view = new PagedView(this.shown);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly preview = signal('');
  /** The preview shows the fields as they are written: nothing is sent or run (the frame is sandboxed). */
  protected readonly previewHtml = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.preview()));
  protected target: 'subject' | 'body' = 'body';
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

  protected async edit(item: EmailTemplateItem): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    this.modalError.set('');
    try {
      const d = await firstValueFrom(this.http.get<EmailTemplateDetails>(`${EmailTemplatesPage.url}/${encodeURIComponent(item.key)}`));
      this.editing.set({ item: d.item, enabled: d.item.enabled, subject: d.item.subject ?? '', body: d.bodyHtml, standardBody: d.standardBody });
      this.preview.set(d.bodyHtml);
      this.target = 'body';
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Adds the field at the end of the subject or the text, whichever was last in focus. */
  protected insert(name: string): void {
    const e = this.editing();
    if (!e) return;
    if (this.target === 'subject') e.subject = `${e.subject}${this.braces(name)}`;
    else {
      e.body = `${e.body}${this.braces(name)}`;
      this.preview.set(e.body);
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

  protected async reset(item: EmailTemplateItem): Promise<void> {
    if (!confirm(`Use the standard e-mail again for "${item.name}"? The saved subject and text are removed.`)) return;
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
