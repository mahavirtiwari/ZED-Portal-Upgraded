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
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    <div class="table-responsive">
      <table class="table table-zed table-bordered bg-white">
        <thead>
          <tr class="btn-default text-center">
            <th>S.No</th><th>Date &amp; Time</th><th>Change</th><th>Where</th><th>Result</th><th>Details</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr>
              <td>{{ (pager.pageNo() - 1) * pager.pageSize() + $index + 1 }}</td>
              <td class="text-nowrap">{{ r.at | date: 'dd-MM-yyyy HH:mm' }}</td>
              <td>{{ r.action }}</td>
              <td>{{ r.channel === 'Mobile' ? 'MSME app' : 'Web' }}@if (showOrigin() && r.ipAddress) {<br /><small class="text-muted">IP {{ r.ipAddress }}</small>}</td>
              <td>
                <span [class]="r.result === 'Success' ? 'text-success' : 'text-danger'">{{ r.result === 'Success' ? 'Saved' : 'Not saved' }}</span>
                @if (r.message) { <br /><small>{{ r.message }}</small> }
              </td>
              <td>
                @if (r.data) {
                  <button type="button" class="btn btn-link btn-sm p-0" [attr.aria-expanded]="open() === r.id" (click)="open.set(open() === r.id ? null : r.id)">
                    {{ open() === r.id ? 'Hide' : 'View' }}
                  </button>
                  @if (open() === r.id) {
                    <ul class="list-unstyled small mb-0 mt-1 values">
                      @for (v of values(r); track $index) { <li>{{ v }}</li> } @empty { <li class="text-muted">No values</li> }
                    </ul>
                  }
                }
              </td>
            </tr>
          } @empty {
            @if (!loading()) { <tr><td colspan="6" style="padding: 0"><div class="no-data">No changes recorded yet</div></td></tr> }
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />
  `,
  styles: `.values { max-width: 420px; word-break: break-word; }`,
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
    return submittedValues(r.data);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const params = new HttpParams().set('pageNo', this.pager.pageNo()).set('pageSize', this.pager.pageSize());
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
      <div class="row mt-4">
        <div class="col-sm-12">
          <h3 class="registration-title">Edit History</h3>
          <p class="text-muted">Every change made in your ZED login, on this website and in the ZED MSME app.</p>
          <zed-edit-history-table url="/api/msme/edit-history" />
        </div>
      </div>
    </div>
  `,
})
export class EditHistoryPage {}
