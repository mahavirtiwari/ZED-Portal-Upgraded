import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DOCUMENT, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PagedView, PagerComponent } from '../pager';
import { fillSampleFields, insertAtCursor, portalBaseUrl } from './email-templates';

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

/**
 * Admin → Texts (new in V4): the disclaimers, instructions, undertakings and pledges of this portal's pages and of its
 * mobile apps. An Admin can hide a text, change its wording (HTML, with the {{Fields}} the page fills in), or reset it. V4
 * layout: page head, search in a filter bar, status badges and row buttons side by side; the editor pop-up has the HTML
 * beside its preview (fields filled with sample values), and field chips that put a field at the cursor.
 */
@Component({
  selector: 'zed-staff-texts',
  imports: [DatePipe, FormsModule, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Texts</h3>
        <p class="page-sub">Disclaimers, instructions, undertakings and pledges of the website and the apps. A change shows within a few minutes.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <ul class="nav nav-tabs mb-3" role="tablist">
      @for (c of channels; track c) {
        <li class="nav-item" role="presentation">
          <button type="button" role="tab" class="nav-link" [class.active]="channel() === c" [attr.aria-selected]="channel() === c"
                  (click)="channel.set(c)">{{ c }} ({{ count(c) }})</button>
        </li>
      }
    </ul>
    <div class="filter-bar mb-3">
      <div class="filter wide">
        <input type="search" class="form-control" placeholder="Search text or page" aria-label="Search texts" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center col-sno">S.No</th>
            <th>Text</th>
            <th class="col-group">Where</th>
            <th class="text-center col-status">Status</th>
            <th class="text-center col-change">Last change</th>
            <th class="text-center col-action">Action</th>
          </tr>
        </thead>
        <tbody>
          @for (t of view.page(); track t.key) {
            <tr>
              <td class="text-center">{{ view.serial($index) }}</td>
              <td><strong>{{ t.name }}</strong></td>
              <td>{{ t.group }}</td>
              <td class="text-center">
                <div class="status-stack">
                  <span class="status-badge" [class.is-active]="t.enabled" [class.is-inactive]="!t.enabled">{{ t.enabled ? 'Shown' : 'Hidden' }}</span>
                  @if (t.customised && t.enabled) { <span class="status-badge is-info">Changed by Admin</span> }
                </div>
              </td>
              <td class="text-center">
                @if (t.updatedOn) {
                  <span class="text-nowrap">{{ t.updatedOn | date: 'dd-MM-yyyy HH:mm' }}</span><small class="muted d-block">{{ t.updatedBy }}</small>
                } @else {
                  <span class="muted" title="Not changed">—</span>
                }
              </td>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  <button type="button" class="btn btn-outline-primary" (click)="edit(t)">Edit</button>
                  @if (t.customised) { <button type="button" class="btn btn-outline-danger" (click)="reset(t)">Reset</button> }
                </div>
              </td>
            </tr>
          } @empty {
            @if (!busy()) { <tr><td colspan="6" style="padding: 0"><div class="no-data">No texts found</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="textTitle">
        <div class="modal-dialog modal-xl modal-dialog-scrollable editor-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="title-block">
                <div class="modal-title" id="textTitle">{{ e.item.name }}</div>
                <small class="muted">{{ e.item.channel }} · {{ e.item.group }}</small>
              </div>
              <button type="button" class="btn-close" aria-label="Close" (click)="editing.set(null)"></button>
            </div>
            <div class="modal-body editor-body">
              <div class="switch-row">
                <div class="form-check form-switch">
                  <input class="form-check-input" type="checkbox" role="switch" id="textEnabled" [(ngModel)]="e.enabled" />
                  <label class="form-check-label" for="textEnabled">{{ e.enabled ? 'This text is shown' : 'This text is hidden' }}</label>
                </div>
              </div>
              @if (e.item.placeholders.length) {
                <div class="fields" role="group" aria-labelledby="textFields">
                  <div class="ed-label" id="textFields">Fields <small class="muted fw-normal">— click one to put it at the cursor in the text</small></div>
                  <div class="chips">
                    @for (p of e.item.placeholders; track p) {
                      <button type="button" class="chip" [title]="'Filled in with ' + p" (mousedown)="$event.preventDefault()" (click)="insert(e, p)">{{ braces(p) }}</button>
                    }
                  </div>
                  <small class="muted d-block">A field is filled in where the text is shown.</small>
                </div>
              }
              <div class="editor">
                <div class="pane">
                  <div class="pane-head">
                    <label class="ed-label" for="textBody">Text (HTML)</label>
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="useStandard(e)">Use the standard text</button>
                  </div>
                  <textarea #bodyBox class="form-control font-monospace code" id="textBody" spellcheck="false" autocomplete="off"
                            [(ngModel)]="e.body" (ngModelChange)="preview.set($event)" (focus)="placed = true"></textarea>
                </div>
                <div class="pane">
                  <div class="pane-head">
                    <span class="ed-label">Preview</span>
                    @if (e.item.placeholders.length) {<small class="muted">fields shown with sample values</small>}
                  </div>
                  <div class="preview" [innerHTML]="previewHtml()"></div>
                </div>
              </div>
              @if (modalError()) { <div class="alert alert-danger mb-0" role="alert">{{ modalError() }}</div> }
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
    .col-sno { width: 70px; }
    .col-group { width: 220px; }
    .col-status { width: 160px; }
    .col-change { width: 160px; }
    .col-action { width: 170px; }
    .status-stack { display: flex; flex-direction: column; align-items: center; gap: 4px; }

    /* Editor pop-up: wide, the full height, the header and footer fixed and the body scrolling. */
    @media (min-width: 576px) { .modal-dialog.editor-dialog { max-width: min(1140px, calc(100vw - 32px)); } }
    .editor-dialog .modal-content { height: 100%; }
    .modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .title-block { min-width: 0; }
    .title-block .muted { display: block; margin-top: 2px; font-size: 13px; }
    .editor-body { display: flex; flex-direction: column; gap: 16px; }
    .ed-label { display: block; margin: 0 0 6px; font-size: 14px; font-weight: 600; color: #23474a; text-transform: none; }
    .switch-row { padding: 10px 14px; background: #eef6f6; border: 1px solid #dfe9ea; border-radius: 10px; }
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
    .pane-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .pane-head .muted { font-size: 12px; }
    .pane-head .btn-link { margin-bottom: 6px; }
    .editor textarea.form-control.code { flex: 1 1 auto; width: 100%; max-width: 100%; min-height: 440px; resize: vertical;
      padding: 10px 12px; font-size: 12.5px; line-height: 1.55; tab-size: 2; background: #fbfdfd; }
    .preview { flex: 1 1 auto; min-height: 440px; border: 1px solid #dfe9ea; border-radius: 8px; background: #fff; padding: 14px 16px; overflow: auto; }
    @media (max-width: 991.98px) { .editor textarea.form-control.code, .preview { min-height: 360px; } }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class TextsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/texts';
  /** {{PublicBaseUrl}} in the preview. */
  private readonly baseUrl = portalBaseUrl(inject(DOCUMENT));
  private readonly bodyBox = viewChild<ElementRef<HTMLTextAreaElement>>('bodyBox');

  protected readonly channels = ['Website', 'Mobile app'];
  protected readonly items = signal<TextItem[]>([]);
  protected readonly channel = signal('Website');
  protected readonly search = signal('');
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.items().filter((t) => t.channel === this.channel() && (!q || `${t.name} ${t.group}`.toLowerCase().includes(q)));
  });
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
    return this.items().filter((t) => t.channel === channel).length;
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
    if (!confirm(`Show the standard text again for "${item.name}"?`)) return;
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
