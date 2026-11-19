import { DatePipe } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PagerComponent, ServerPager } from '../../staff/pager';
import { PageHead } from '../shared/page-head';
import { ProfileShell } from '../profile/profile-shell';
import { TextPipe, t } from '../../content/page-text';

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
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files', staff-15): <code>layout="table"</code> (the staff MSME profile):
 * one row per change with its date and time, an uppercase type pill (Profile, Password, Certification, Payments, by the same
 * rules as the server's filters), the one-line summary and "Show details" at the right; rounded filter chips; the same paging.
 * The MSME's own page keeps the timeline.
 */
@Component({
  selector: 'zed-edit-history-table',
  imports: [DatePipe, PagerComponent, TextPipe],
  template: `
    <div class="eh-filters" [class.eh-round]="layout() === 'table'" role="group" [attr.aria-label]="'Show changes' | t: 'common.editHistory.filter.aria'">
      @for (k of kinds(); track k.key) {
        <button type="button" class="eh-chip" [class.active]="kind() === k.key" [attr.aria-pressed]="kind() === k.key" (click)="setKind(k.key)">{{ k.label }}</button>
      }
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (layout() === 'table') {
      <div class="eh-table" data-eh-table>
        @for (r of rows(); track r.id) {
          <div class="eh-row">
            <span class="eh-at">{{ r.at | date: 'd MMM y, HH:mm' }}</span>
            <span class="eh-type">@if (typeOf(r.action); as ty) { <span class="eh-pill" [attr.data-type]="ty">{{ typeLabel(ty) }}</span> }</span>
            <span class="eh-sum">{{ title(r.action) }}@if (r.result !== 'Success') {&ngsp;<span class="status-badge is-rejected">{{ 'Not saved' | t: 'common.editHistory.notSavedLabel' }}</span>}
              @if (r.message) { <small>{{ r.message }}</small> }</span>
            @if (values(r).length || (showOrigin() && r.ipAddress)) {
              <button type="button" class="eh-more" [attr.aria-expanded]="open() === r.id" (click)="open.set(open() === r.id ? null : r.id)">
                {{ open() === r.id ? ('Hide details' | t: 'common.editHistory.hideButton') : ('Show details' | t: 'common.editHistory.showButton') }}</button>
            } @else { <span></span> }
            @if (open() === r.id) {
              <ul class="list-unstyled small mb-0 values eh-vals">
                <li class="text-muted">{{ r.channel === 'Mobile' ? ('MSME app' | t: 'common.editHistory.appLabel') : ('Web' | t: 'common.editHistory.webLabel') }}@if (showOrigin() && r.ipAddress) { · {{ 'IP {ip}' | t: 'common.editHistory.ipLabel' : { ip: r.ipAddress } }} }</li>
                @for (v of values(r); track $index) { <li>{{ v }}</li> }
              </ul>
            }
          </div>
        } @empty {
          @if (!loading()) { <div class="no-data">{{ 'No changes recorded yet' | t: 'common.editHistory.empty' }}</div> }
        }
      </div>
    } @else {
    <div class="timeline" [class.is-empty]="!rows().length">
      @for (r of rows(); track r.id; let i = $index) {
        @if (i === 0 || dayOf(rows()[i - 1].at) !== dayOf(r.at)) {
          <div class="eh-day">{{ r.at | date: 'd MMMM y' }}</div>
        }
        <div class="eh-item">
          <span class="eh-dot" aria-hidden="true"></span>
          <div class="eh-head">
            <span class="eh-title">{{ title(r.action) }}</span>
            <span class="eh-meta">
              <span class="eh-where">{{ r.channel === 'Mobile' ? ('MSME app' | t: 'common.editHistory.appLabel') : ('Web' | t: 'common.editHistory.webLabel') }}</span>
              <span class="status-badge" [class.is-success]="r.result === 'Success'" [class.is-rejected]="r.result !== 'Success'">{{ r.result === 'Success' ? ('Saved' | t: 'common.editHistory.savedLabel') : ('Not saved' | t: 'common.editHistory.notSavedLabel') }}</span>
              <span class="eh-time">{{ r.at | date: 'HH:mm' }}</span>
            </span>
          </div>
          @if (r.message) { <div class="eh-message">{{ r.message }}</div> }
          @if (showOrigin() && r.ipAddress) { <div class="eh-message text-muted">{{ 'IP {ip}' | t: 'common.editHistory.ipLabel' : { ip: r.ipAddress } }}</div> }
          @if (values(r).length) {
            <button type="button" class="btn btn-link btn-sm p-0" [attr.aria-expanded]="open() === r.id" (click)="open.set(open() === r.id ? null : r.id)">
              {{ open() === r.id ? ('Hide details' | t: 'common.editHistory.hideButton') : ('Show details' | t: 'common.editHistory.showButton') }}
            </button>
            @if (open() === r.id) {
              <ul class="list-unstyled small mb-0 mt-1 values">
                @for (v of values(r); track $index) { <li>{{ v }}</li> }
              </ul>
            }
          }
        </div>
      } @empty {
        @if (!loading()) { <div class="no-data">{{ 'No changes recorded yet' | t: 'common.editHistory.empty' }}</div> }
      }
    </div>
    }
    <zed-pager [pager]="pager" />
  `,
  styles: `
    .eh-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .eh-chip { border: 1px solid var(--zt-soft, #d9eef0); background: var(--zt-soft, #d9eef0); border-radius: 6px; padding: 3px 14px; font-weight: 500; color: var(--zt-ink, #174a4e); }
    .eh-chip.active { background: var(--zt-dark, #23656b); border-color: var(--zt-dark, #23656b); color: #fff; }
    .timeline { border-left: 2px solid #d6e9eb; margin-left: 8px; padding-left: 20px; }
    .timeline.is-empty { border-left: 0; margin-left: 0; padding-left: 0; }
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
    .eh-round { margin: 0; padding: 14px 20px; border-bottom: 1px solid #edf2f2; }
    .eh-round .eh-chip { height: 32px; padding: 0 14px; border: 1px solid #dde7e8; border-radius: 16px; background: #fff; font-size: 13px; color: #17373b; }
    .eh-round .eh-chip.active { background: #24666b; border-color: #24666b; color: #fff; font-weight: 700; }
    .eh-row { display: grid; grid-template-columns: 166px 150px minmax(0, 1fr) auto; align-items: center; gap: 4px 0; padding: 14px 24px; border-bottom: 1px solid #edf2f2; }
    .eh-at { font-size: 12.5px; color: #6f8487; }
    .eh-pill { display: inline-block; padding: 3px 16px; border-radius: 11px; background: #ecf0f0; color: #6f8487; font-size: 10.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; }
    .eh-pill[data-type='Profile'] { background: #e6f2f3; color: #24666b; }
    .eh-pill[data-type='Certification'] { background: #e5f5ea; color: #2f9e58; }
    .eh-pill[data-type='Payments'] { background: #fdf2dc; color: #9a5f06; }
    .eh-sum { font-size: 13.5px; font-weight: 500; color: #17373b; min-width: 0; overflow-wrap: anywhere; }
    .eh-sum small { display: block; font-size: 12px; color: #6f8487; }
    .eh-more { border: 0; background: none; padding: 0; font-size: 13px; font-weight: 700; color: #24666b; white-space: nowrap; }
    .eh-vals { grid-column: 3 / -1; margin-top: 8px !important; }
    @media (max-width: 767.98px) { .eh-row { grid-template-columns: minmax(0, 1fr) auto; } .eh-vals { grid-column: 1 / -1; } }
  `,
})
export class EditHistoryTable {
  /** The API that pages the history (api/msme/edit-history or api/staff/msme-edit-history/{zedId}). */
  readonly url = input.required<string>();
  /** Staff see the IP address too. */
  readonly showOrigin = input(false);
  /** 2026-11-18: 'table' (staff MSME profile, staff-15) or the MSME's timeline. */
  readonly layout = input<'timeline' | 'table'>('timeline');

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
  protected readonly kinds = computed(() => [
    { key: '', label: t('common.editHistory.chip.all', 'All') },
    { key: 'profile', label: t('common.editHistory.chip.profile', 'Profile') },
    { key: 'password', label: t('common.editHistory.chip.password', 'Password') },
    { key: 'certification', label: t('common.editHistory.chip.certification', 'Certification') },
    { key: 'payment', label: t('common.editHistory.chip.payments', 'Payments') },
  ]);
  protected readonly kind = signal('');

  protected setKind(kind: string): void {
    this.kind.set(kind);
    this.pager.reset();
    void this.load();
  }

  /** "App: password changed" -> "Password changed" (where it was made has its own chip). */
  protected title(action: string): string {
    const s = action.replace(/^(App|Web)\s*:\s*/i, '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : action;
  }

  /** The change's type pill, by the server's filter rules (MsmeEditHistoryController.Kinds); '' when none applies. */
  protected typeOf(action: string): string {
    const a = action.replace(/^(App|Web)\s*:\s*/i, '').toLowerCase();
    if (a.startsWith('profile:')) return 'Profile';
    if (a.includes('password')) return 'Password';
    if (a.includes('certification')) return 'Certification';
    if (a.includes('payment')) return 'Payments';
    return '';
  }

  /** The pill's wording of a type (typeOf keeps the code, used for its colour). */
  protected typeLabel(type: string): string {
    switch (type) {
      case 'Profile': return t('common.editHistory.type.profile', 'Profile');
      case 'Password': return t('common.editHistory.type.password', 'Password');
      case 'Certification': return t('common.editHistory.type.certification', 'Certification');
      case 'Payments': return t('common.editHistory.type.payments', 'Payments');
      default: return type;
    }
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

/**
 * MSME → Edit History: the signed-in applicant's own changes. 2026-11-17 (the user's approved design "Enterprise
 * profile"): a section of the profile, with the profile's section menu on the left.
 */
@Component({
  selector: 'zed-msme-edit-history',
  imports: [EditHistoryTable, PageHead, ProfileShell, TextPipe],
  template: `
    <div class="container eh-page">
      <zed-page-head [crumbs]="crumbs()" [title]="'Edit history' | t: 'msme.editHistory.title'" />
      <zed-profile-shell active="history">
        <div class="eh-card"><zed-edit-history-table url="/api/msme/edit-history" /></div>
      </zed-profile-shell>
    </div>
  `,
  styles: `
    .eh-page { padding-top: 16px; padding-bottom: 32px; }
    .eh-card { background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; padding: 18px 22px; box-shadow: 0 2px 8px rgba(23, 63, 68, .05); }
    @media (max-width: 767.98px) { .eh-card { padding: 14px 16px; } }
  `,
})
export class EditHistoryPage {
  protected readonly crumbs = computed(() => [
    { label: t('msme.editHistory.crumb.home', 'Home'), link: '/msme/dashboard' },
    { label: t('msme.editHistory.crumb.profile', 'Profile'), link: '/msme/profile' },
    { label: t('msme.editHistory.crumb.history', 'Edit history') },
  ]);
}
