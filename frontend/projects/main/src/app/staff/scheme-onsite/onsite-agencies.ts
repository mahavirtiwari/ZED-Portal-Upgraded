import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { ConfirmAsk, ConfirmDialog, ConfirmResult } from '../confirm-dialog';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { RowMenu, RowMenuItem } from '../row-menu';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { OnsiteAgencyRow, SchemeOnsiteApi } from './scheme-onsite.api';

type Action = 'edit' | 'deactivate' | 'activate' | 'reset';

/**
 * 2026-11-20 (the user, incentive schemes phase 2): the Master Admin's "Onsite Verification Agencies" — the agencies that verify
 * incentive scheme applications (Desktop + Onsite schemes) at the unit, kept apart from the assessment agencies: their states and
 * districts, the schemes they serve, their assessors; add, edit, activate / deactivate, send a set-password link.
 */
@Component({
  selector: 'zed-staff-onsite-agencies',
  imports: [RouterLink, PageHead, PagerComponent, RowMenu, ConfirmDialog, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" [title]="'Onsite Verification Agencies' | t: 'staff.schemeOnsite.agencies.title'"
                   [subtitle]="'Agencies that verify incentive scheme applications at the unit (Desktop + Onsite schemes), by state and district. Assessment agencies are kept on their own page.' | t: 'staff.schemeOnsite.agencies.sub'">
      <a routerLink="new" class="btn btn-primary" data-add>{{ 'Add onsite agency' | t: 'staff.schemeOnsite.agencies.add' }}</a>
    </zed-page-head>
    <div class="zed-card oa-filters">
      <input type="search" class="form-control oa-q" maxlength="50" [placeholder]="'Search agencies' | t: 'staff.schemeOnsite.agencies.search'"
             [attr.aria-label]="'Search agencies' | t: 'staff.schemeOnsite.agencies.search'" [value]="search()" (input)="search.set($any($event.target).value)" />
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <div class="list-card">
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th>{{ 'Agency' | t: 'staff.schemeOnsite.column.agency' }}</th>
              <th>{{ 'SPOC' | t: 'staff.schemeOnsite.column.spoc' }}</th>
              <th>{{ 'States and districts' | t: 'staff.schemeOnsite.column.area' }}</th>
              <th>{{ 'Schemes' | t: 'staff.schemeOnsite.column.schemes' }}</th>
              <th class="text-end">{{ 'Assessors' | t: 'staff.schemeOnsite.column.assessors' }}</th>
              <th>{{ 'Status' | t: 'staff.schemeOnsite.column.status' }}</th>
              <th class="text-end">{{ 'Action' | t: 'staff.schemeOnsite.column.action' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (r of view.page(); track r.userId) {
              <tr>
                <td class="unit-cell"><b>{{ r.userName }}</b><small>{{ r.userId }}</small></td>
                <td class="unit-cell"><b>{{ r.spocName || '–' }}</b><small>{{ r.email }}@if (r.mobileNo) { · {{ r.mobileNo }} }</small></td>
                <td class="oa-area">
                  @for (a of r.states; track a.state) {
                    <span class="d-block">{{ a.state }} <small>{{ a.districts.length ? ('{n} district(s)' | t: 'staff.schemeOnsite.row.districts' : { n: a.districts.length }) : ('whole state' | t: 'staff.schemeOnsite.row.wholeState') }}</small></span>
                  } @empty { <span class="sub">–</span> }
                </td>
                <td>{{ r.schemes.join(', ') || '–' }}</td>
                <td class="text-end">{{ r.assessors }}</td>
                <td><span [class]="'chip ' + (r.isActive ? 'is-good' : 'is-bad')">{{ r.isActive ? ('Active' | t: 'staff.schemeOnsite.row.active') : ('Inactive' | t: 'staff.schemeOnsite.row.inactive') }}</span></td>
                <td class="text-end">
                  <div class="oa-act">
                    <a class="btn btn-outline-primary btn-sm" [routerLink]="[r.userId]">{{ 'Edit' | t: 'staff.schemeOnsite.action.edit' }}</a>
                    <zed-row-menu [items]="menu(r)" [label]="'More actions for {name}' | t: 'staff.schemeOnsite.row.menuAria' : { name: r.userName }" (picked)="act(r, $event)" />
                  </div>
                </td>
              </tr>
            } @empty {
              @if (!loading()) {
                <tr><td colspan="7" style="padding: 0"><div class="no-data">{{ search() ? ('No agency matches the search.' | t: 'staff.schemeOnsite.agencies.searchEmpty') : ('No onsite verification agency yet.' | t: 'staff.schemeOnsite.agencies.empty') }}</div></td></tr>
              }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    </div>
    @if (dialog(); as d) {
      <zed-confirm-dialog [ask]="d.ask" [busy]="busy()" [failed]="failed()" inputId="oa-dialog-text" (decided)="confirm($event)" (cancel)="close()" />
    }
    @if (loading()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .oa-filters { padding: 11px 15px; margin-bottom: 16px; }
    .oa-q { max-width: 300px; height: 38px; border: 1.2px solid #b9cdcf; border-radius: 9px; font-size: 13px; }
    .oa-area small { color: #5f6f70; }
    .oa-act { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class OnsiteAgenciesPage {
  private readonly api = inject(SchemeOnsiteApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly crumbs = staffCrumbs({ label: t('staff.schemeOnsite.agencies.title', 'Onsite Verification Agencies') });
  protected readonly rows = signal<OnsiteAgencyRow[]>([]);
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.search()));
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly dialog = signal<{ ask: ConfirmAsk; run: (r: ConfirmResult) => Promise<string> } | null>(null);
  protected readonly busy = signal(false);
  protected readonly failed = signal('');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.rows.set(await firstValueFrom(this.api.list()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected menu(r: OnsiteAgencyRow): (RowMenuItem & { key: Action })[] {
    return [
      { key: 'reset', label: t('staff.schemeOnsite.action.reset', 'Send set-password link'), icon: 'mail' },
      r.isActive
        ? { key: 'deactivate', label: t('staff.schemeOnsite.action.deactivate', 'Deactivate'), icon: 'lock', danger: true }
        : { key: 'activate', label: t('staff.schemeOnsite.action.activate', 'Activate'), icon: 'unlock' },
    ];
  }

  protected act(r: OnsiteAgencyRow, key: string): void {
    const subtitle = `${r.userName} · ${r.userId}`;
    this.failed.set('');
    switch (key as Action) {
      case 'edit':
        void this.router.navigate(['/staff/scheme-onsite/agencies', r.userId]);
        return;
      case 'reset':
        this.dialog.set({
          ask: {
            title: t('staff.schemeOnsite.dialog.resetTitle', 'Send a set-password link'), subtitle, icon: 'mail',
            message: t('staff.schemeOnsite.dialog.resetMessage', 'The agency’s SPOC gets an e-mail with a link to set a new password.'),
            confirmLabel: t('staff.schemeOnsite.dialog.resetButton', 'Send'),
          },
          run: async () => (await firstValueFrom(this.api.passwordReset(r.userId))).message,
        });
        return;
      case 'deactivate':
      case 'activate': {
        const active = key === 'activate';
        this.dialog.set({
          ask: {
            title: active ? t('staff.schemeOnsite.dialog.activateTitle', 'Activate the agency') : t('staff.schemeOnsite.dialog.deactivateTitle', 'Deactivate the agency'),
            subtitle, danger: !active, icon: active ? 'unlock' : 'lock',
            message: active
              ? t('staff.schemeOnsite.dialog.activateMessage', 'The agency can sign in again and is allotted applications of its states and districts.')
              : t('staff.schemeOnsite.dialog.deactivateMessage', 'The agency can no longer sign in and is not allotted new applications.'),
            reason: { label: t('staff.schemeOnsite.dialog.reasonLabel', 'Reason'), maxLength: 2000,
              hint: t('staff.schemeOnsite.dialog.reasonHint', 'Kept in the history and e-mailed to the agency.') },
            confirmLabel: active ? t('staff.schemeOnsite.dialog.activateButton', 'Activate') : t('staff.schemeOnsite.dialog.deactivateButton', 'Deactivate'),
          },
          run: async (res) => (await firstValueFrom(this.api.setActive(r.userId, active, res.reason))).message,
        });
        return;
      }
    }
  }

  protected close(): void {
    if (!this.busy()) this.dialog.set(null);
  }

  protected async confirm(r: ConfirmResult): Promise<void> {
    const d = this.dialog();
    if (!d || this.busy()) return;
    this.busy.set(true);
    try {
      const message = await d.run(r);
      this.dialog.set(null);
      this.toast.success(message);
      await this.load();
    } catch (err) {
      this.failed.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
