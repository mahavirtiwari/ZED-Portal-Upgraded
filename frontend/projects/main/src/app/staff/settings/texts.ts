import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PagedView, PagerComponent } from '../pager';

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
 * layout: page head, search in a filter bar, status badges and row buttons side by side.
 */
@Component({
  selector: 'zed-staff-texts',
  imports: [DatePipe, FormsModule, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Texts</h3>
        <p class="page-sub">Disclaimers, instructions, undertakings and pledges. A change is shown on the website and in the apps within a few minutes.</p>
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
            <th class="text-center" style="width: 60px">S.No</th><th>Text</th><th>Where</th><th class="text-center" style="width: 150px">Status</th><th class="text-center" style="width: 150px">Last change</th><th class="text-center" style="width: 150px">Action</th>
          </tr>
        </thead>
        <tbody>
          @for (t of view.page(); track t.key) {
            <tr>
              <td class="text-center">{{ view.serial($index) }}</td>
              <td><strong>{{ t.name }}</strong></td>
              <td>{{ t.group }}</td>
              <td class="text-center">
                <span class="status-badge" [class.is-active]="t.enabled" [class.is-inactive]="!t.enabled">{{ t.enabled ? 'Shown' : 'Hidden' }}</span>
                @if (t.customised && t.enabled) { <small class="text-muted d-block mt-1">Changed by Admin</small> }
              </td>
              <td class="text-center">@if (t.updatedOn) { {{ t.updatedOn | date: 'dd-MM-yyyy HH:mm' }}<small class="text-muted d-block">{{ t.updatedBy }}</small> }</td>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  <button type="button" class="btn btn-outline-primary" (click)="edit(t)">Edit</button>
                  @if (t.customised) { <button type="button" class="btn btn-default" (click)="reset(t)">Reset</button> }
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
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <div class="modal-title" id="textTitle"><strong>{{ e.item.name }}</strong> <small class="text-muted">· {{ e.item.channel }} · {{ e.item.group }}</small></div>
              <button type="button" class="close btn btn-link" aria-label="Close" (click)="editing.set(null)"><strong>x&nbsp;</strong></button>
            </div>
            <div class="modal-body">
              <div class="form-check form-switch mb-3">
                <input class="form-check-input" type="checkbox" role="switch" id="textEnabled" [(ngModel)]="e.enabled" />
                <label class="form-check-label" for="textEnabled"><strong>{{ e.enabled ? 'This text is shown' : 'This text is hidden' }}</strong></label>
              </div>
              @if (e.item.placeholders.length) {
                <div class="form-grid mb-3">
                  <span class="label top">Fields:</span>
                  <div>
                    @for (p of e.item.placeholders; track p) {
                      <button type="button" class="btn btn-outline-primary btn-sm me-1 mb-1 chip" (click)="insert(e, p)">{{ braces(p) }}</button>
                    }
                    <small class="text-muted d-block">A field is filled in where the text is shown.</small>
                  </div>
                </div>
              }
              <div class="row g-3">
                <div class="col-lg-6">
                  <label class="form-label d-flex justify-content-between" for="textBody">
                    <strong>Text (HTML)</strong>
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="useStandard(e)">Use the standard text</button>
                  </label>
                  <textarea class="form-control font-monospace body" id="textBody" spellcheck="false" [(ngModel)]="e.body" (input)="preview.set(e.body)"></textarea>
                </div>
                <div class="col-lg-6">
                  <span class="form-label d-block"><strong>Preview</strong></span>
                  <div class="preview" [innerHTML]="preview()"></div>
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
    .body { min-height: 360px; font-size: 12px; }
    .preview { min-height: 360px; border: 1px solid #ced4da; border-radius: 4px; background: #fff; padding: 12px; overflow: auto; }
    .chip { font-family: monospace; font-size: 12px; }
    .form-grid > .top { align-self: start; padding-top: 6px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class TextsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/texts';

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
  /** Angular's sanitizer cleans the preview as it does the pages. */
  protected readonly preview = signal('');
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
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected insert(e: Editing, name: string): void {
    e.body = `${e.body}${this.braces(name)}`;
    this.preview.set(e.body);
  }

  protected useStandard(e: Editing): void {
    e.body = e.standard;
    this.preview.set(e.body);
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
