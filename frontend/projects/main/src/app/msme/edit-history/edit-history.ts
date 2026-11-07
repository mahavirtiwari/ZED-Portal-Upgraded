import { DatePipe } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PagerComponent, ServerPager } from '../../staff/pager';

export interface EditItem {
  id: number;
  at: string;
  channel: string;
  action: string;
  result: string;
  message: string | null;
  data: string | null;
  ipAddress: string | null;
  deviceId: string | null;
}

interface EditHistoryResponse {
  total: number;
  pageNo: number;
  pageSize: number;
  rows: EditItem[];
}

function isFile(value: unknown): value is { file: string; bytes: number } {
  return !!value && typeof value === 'object' && typeof (value as { file?: unknown }).file === 'string' && typeof (value as { bytes?: unknown }).bytes === 'number';
}

/** One submitted value for display: "Field: value", nested objects flattened with dots. */
export function submittedValues(data: string | null): string[] {
  if (!data) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [data];
  }
  const out: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i + 1}]`));
    else if (isFile(value)) out.push(`${path || 'File'}: ${value.file} (${Math.max(1, Math.ceil(value.bytes / 1024))} KB)`);
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k);
    else out.push(`${path}: ${value}`);
  };
  // The top level holds the action's argument names (req, request, file, ...): not shown.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    for (const v of Object.values(parsed as Record<string, unknown>)) walk(v, '');
  return out;
}

/**
 * The applicant's change history (new in V4): every change made in the MSME login on the web and in the MSME app, newest
 * first, with what was submitted. Used by the MSME (Edit History) and by the overseeing staff (MSME profile).
 */
@Component({
  selector: 'zed-edit-history-table',
  imports: [DatePipe, PagerComponent],
  template: `
    <div class="eh-filters" role="group" aria-label="Show changes">
      @for (k of kinds; track k.key) {
        <button type="button" class="eh-chip" [class.active]="kind() === k.key" [attr.aria-pressed]="kind() === k.key" (click)="setKind(k.key)">{{ k.label }}</button>
      }
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    <div class="timeline">
      @for (r of rows(); track r.id; let i = $index) {
        @if (i === 0 || dayOf(rows()[i - 1].at) !== dayOf(r.at)) {
          <div class="eh-day">{{ r.at | date: 'd MMMM y' }}</div>
        }
        <div class="eh-item">
          <span class="eh-dot" aria-hidden="true"></span>
          <div class="eh-head">
            <span class="eh-title">{{ title(r.action) }}</span>
            <span class="eh-meta">
              <span class="eh-where">{{ r.channel === 'Mobile' ? 'MSME app' : 'Web' }}</span>
              <span class="status-badge" [class.is-success]="r.result === 'Success'" [class.is-rejected]="r.result !== 'Success'">{{ r.result === 'Success' ? 'Saved' : 'Not saved' }}</span>
              <span class="eh-time">{{ r.at | date: 'HH:mm' }}</span>
            </span>
          </div>
          @if (r.message) { <div class="eh-message">{{ r.message }}</div> }
          @if (showOrigin() && r.ipAddress) { <div class="eh-message text-muted">IP {{ r.ipAddress }}</div> }
          @if (values(r).length) {
            <button type="button" class="btn btn-link btn-sm p-0" [attr.aria-expanded]="open() === r.id" (click)="open.set(open() === r.id ? null : r.id)">
              {{ open() === r.id ? 'Hide details' : 'Show details' }}
            </button>
            @if (open() === r.id) {
              <ul class="list-unstyled small mb-0 mt-1 values">
                @for (v of values(r); track $index) { <li>{{ v }}</li> }
              </ul>
            }
          }
        </div>
      } @empty {
        @if (!loading()) { <div class="no-data">No changes recorded yet</div> }
      }
    </div>
    <zed-pager [pager]="pager" />
  `,
  styles: `
    .eh-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .eh-chip { border: 1px solid #ccd2d5; background: #fff; border-radius: 16px; padding: 3px 14px; font-weight: 500; color: #3a3c3e; }
    .eh-chip.active { background: #45a5ad; border-color: #45a5ad; color: #fff; }
    .timeline { border-left: 2px solid #d6e9eb; margin-left: 8px; padding-left: 20px; }
    .eh-day { color: #7a7d80; font-weight: 600; margin: 14px 0 6px -20px; padding-left: 0; background: #fff; position: relative; left: -10px; }
    .eh-item { position: relative; border: 1px solid #e3e6e8; border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; background: #fff; }
    .eh-dot { position: absolute; left: -28px; top: 14px; width: 14px; height: 14px; border-radius: 50%; background: #45a5ad; border: 3px solid #fff; box-shadow: 0 0 0 1px #45a5ad; }
    .eh-head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: center; }
    .eh-title { font-weight: 700; color: #232527; }
    .eh-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .eh-where { background: #eef2f3; border-radius: 10px; padding: 1px 10px; font-size: 0.85rem; }
    .eh-time { color: #7a7d80; font-size: 0.9rem; }
    .eh-message { font-size: 0.9rem; margin-top: 2px; }
    .values { max-width: 520px; word-break: break-word; background: #f7f8f9; border-radius: 6px; padding: 6px 10px; }
  `,
})
export class EditHistoryTable {
  /** The API that pages the history (api/msme/edit-history or api/staff/msme-edit-history/{zedId}). */
  readonly url = input.required<string>();
  /** Staff see the IP address too. */
  readonly showOrigin = input(false);

  private readonly http = inject(HttpClient);
  protected readonly rows = signal<EditItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly open = signal<number | null>(null);
  protected readonly pager = new ServerPager(10, () => void this.load());

  constructor() {
    effect(() => {
      this.url();
      untracked(() => {
        this.pager.reset();
        void this.load();
      });
    });
  }

  protected values(r: EditItem): string[] {
    // Secrets are masked (***) by the server; they are not listed at all (2026-11-07).
    return submittedValues(r.data).filter((v) => !v.endsWith(': ***'));
  }

  /** The filters (server side, all pages): Action LIKE ... (MsmeEditHistoryResponses.Kinds). */
  protected readonly kinds = [
    { key: '', label: 'All' },
    { key: 'profile', label: 'Profile' },
    { key: 'password', label: 'Password' },
    { key: 'certification', label: 'Certification' },
    { key: 'payment', label: 'Payments' },
  ];
  protected readonly kind = signal('');

  protected setKind(kind: string): void {
    this.kind.set(kind);
    this.pager.reset();
    void this.load();
  }

  /** "App: password changed" -> "Password changed" (where it was made has its own chip). */
  protected title(action: string): string {
    const t = action.replace(/^(App|Web)\s*:\s*/i, '').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : action;
  }

  protected dayOf(at: string): string {
    return new Date(at).toDateString();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      let params = new HttpParams().set('pageNo', this.pager.pageNo()).set('pageSize', this.pager.pageSize());
      if (this.kind()) params = params.set('kind', this.kind());
      const r = await firstValueFrom(this.http.get<EditHistoryResponse>(this.url(), { params }));
      this.rows.set(r.rows);
      this.pager.total.set(r.total);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}

/** MSME → Edit History: the signed-in applicant's own changes. */
@Component({
  selector: 'zed-msme-edit-history',
  imports: [EditHistoryTable],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="page-head mt-4">
        <div>
          <h3 class="registration-title">Edit History</h3>
        </div>
      </div>
      <zed-edit-history-table url="/api/msme/edit-history" />
    </div>
  `,
})
export class EditHistoryPage {}
