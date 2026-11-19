import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { ConfirmService } from '../confirm-dialog';
import { TextPipe, t } from '../../content/page-text';

export interface MaintenanceRow {
  key: string;
  name: string;
  down: boolean;
  message: string | null;
  from: string | null;
  until: string | null;
  downNow: boolean;
  defaultMessage: string;
}

/**
 * Admin → Settings → Maintenance mode (2026-11-15, design approved; main portal only). For each portal and app: Up / Down,
 * the message its users see, and an optional window (down from its start to its end, by itself). The Admin can always
 * sign in on the main portal.
 */
@Component({
  selector: 'zed-maintenance-mode',
  imports: [FormsModule, PageHead, TextPipe],
  template: `
    <zed-page-head [title]="'Maintenance mode' | t: 'staff.maintenance.title'" [crumbs]="crumbs()" />
    <p class="page-sub mm-sub">{{ 'Take a portal or app down for work. The Admin can always sign in on the main portal.' | t: 'staff.maintenance.sub' }}</p>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }

    <form class="zed-card mm-card" (ngSubmit)="save()" novalidate>
      <div class="table-responsive">
        <table class="table table-zed mm-table">
          <!-- 2026-11-19 (admin audit): the message gets the room; the window is two date boxes of their own width. -->
          <colgroup><col style="width: 19%" /><col style="width: 104px" /><col /><col style="width: 390px" /></colgroup>
          <thead>
            <tr><th>{{ 'Portal / app' | t: 'staff.maintenance.column.portal' }}</th><th class="text-center">{{ 'State' | t: 'staff.maintenance.column.state' }}</th><th>{{ 'Message shown to users' | t: 'staff.maintenance.column.message' }}</th><th>{{ 'Window (optional)' | t: 'staff.maintenance.column.window' }}</th></tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.key) {
              <tr [class.is-down]="r.down || r.downNow">
                <td [attr.data-label]="'Portal / app' | t: 'staff.maintenance.column.portal'">
                  <strong>{{ r.name }}</strong>
                  @if (r.downNow) { <span class="mm-now">{{ 'Down now' | t: 'staff.maintenance.row.downNow' }}</span> }
                </td>
                <td class="text-center" [attr.data-label]="'State' | t: 'staff.maintenance.column.state'">
                  <label class="mm-switch" [class.down]="r.down">
                    <input type="checkbox" role="switch" [name]="'down-' + r.key" [attr.aria-label]="'{name} down' | t: 'staff.maintenance.row.downAria' : { name: r.name }" [(ngModel)]="r.down" />
                    <span class="mm-track" aria-hidden="true"></span>{{ r.down ? ('Down' | t: 'staff.maintenance.row.down') : ('Up' | t: 'staff.maintenance.row.up') }}
                  </label>
                </td>
                <td class="mm-lab" [attr.data-label]="'Message' | t: 'staff.maintenance.row.messageLabel'">
                  <input class="form-control" [name]="'message-' + r.key" maxlength="300" [placeholder]="r.defaultMessage"
                         [attr.aria-label]="'Message of {name}' | t: 'staff.maintenance.row.messageAria' : { name: r.name }" [(ngModel)]="r.message" />
                </td>
                <td class="mm-lab" [attr.data-label]="'Window' | t: 'staff.maintenance.row.windowLabel'">
                  <div class="mm-window">
                    <input type="datetime-local" class="form-control" [name]="'from-' + r.key" [attr.aria-label]="'{name} down from' | t: 'staff.maintenance.row.fromAria' : { name: r.name }" [(ngModel)]="r.from" />
                    <span class="muted">{{ 'to' | t: 'staff.maintenance.row.to' }}</span>
                    <input type="datetime-local" class="form-control" [name]="'until-' + r.key" [attr.aria-label]="'{name} up again at' | t: 'staff.maintenance.row.untilAria' : { name: r.name }" [(ngModel)]="r.until" />
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted mm-note">
        {{ 'Down: the portal shows a maintenance page with the message (users signed in see it on their next click); the app shows the message instead of its screens. With a window, it goes down at the start and comes up at the end by itself; switched Down with only an end, it comes up at the end. Payments already started still complete.' | t: 'staff.maintenance.note' }}
      </p>
      <div class="mm-actions">
        <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ 'Save' | t: 'staff.maintenance.saveButton' }}</button>
      </div>
    </form>
    @if (busy()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .mm-sub { margin: -8px 0 14px; color: #5f6f70; }
    .mm-card { padding: 16px; }
    .mm-table { table-layout: fixed; min-width: 880px; }
    .mm-table td { vertical-align: middle; }
    .mm-table tr.is-down td { background: #fdf6f5; }
    .mm-now { display: inline-block; margin-left: 8px; font-size: 11.5px; font-weight: 700; color: #b03a2e; background: #fbe4e1; border-radius: 4px; padding: 1px 7px; }
    .mm-switch { position: relative; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; font-weight: 600; color: #1e7a3c; cursor: pointer; text-transform: none; }
    .mm-switch.down { color: #b03a2e; }
    .mm-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .mm-track { position: relative; width: 34px; height: 18px; border-radius: 10px; background: #45a5ad; flex: none; transition: background .15s; }
    .mm-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .15s; }
    .mm-switch.down .mm-track { background: #d9776b; }
    .mm-switch.down .mm-track::after { left: 18px; }
    .mm-switch input:focus-visible + .mm-track { outline: 2px solid var(--zt-dark, #23656b); outline-offset: 2px; }
    .mm-window { display: flex; align-items: center; gap: 6px; }
    .mm-window .form-control { min-width: 0; flex: 1 1 0; }
    .mm-window .muted { flex: none; }
    .mm-note { font-size: 13px; margin: 8px 0 0; }
    .mm-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
    /* Phone and tablet: one card per portal, no sideways scroll. */
    @media (max-width: 991.98px) {
      .mm-table { min-width: 0; table-layout: auto; }
      .mm-table thead, .mm-table colgroup { display: none; }
      .mm-table, .mm-table tbody, .mm-table tr, .mm-table td { display: block; width: 100%; }
      .mm-table tr { border: 1px solid #dfe9ea; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; }
      .mm-table td { border: 0; padding: 4px 0; text-align: left !important; background: none !important; }
      .mm-table tr.is-down { background: #fdf6f5; }
      .mm-table td.mm-lab::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .mm-window { flex-wrap: wrap; }
      .mm-window .form-control { flex: 1 1 180px; }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class MaintenanceModePage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private static readonly url = '/api/staff/settings/maintenance';
  protected readonly crumbs = computed(() => [
    { label: t('staff.maintenance.crumb.settings', 'All settings'), link: '/staff/administration' },
    { label: t('staff.maintenance.crumb.page', 'Maintenance mode') },
  ]);
  protected readonly rows = signal<MaintenanceRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected async save(): Promise<void> {
    const down = this.rows().filter((r) => r.down && !this.loaded.get(r.key));
    if (down.length && !(await this.confirms.ask({
      title: t('staff.maintenance.confirm.title', 'Take It Down Now?'),
      message: t('staff.maintenance.confirm.message', '{names}: its users see the maintenance message.', { names: down.map((r) => r.name).join(', ') }),
      confirmLabel: t('staff.maintenance.confirm.button', 'Take Down'), danger: true,
    }))) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const body = this.rows().map((r) => ({ key: r.key, down: r.down, message: r.message || null, from: r.from || null, until: r.until || null }));
      const res = await firstValueFrom(this.http.put<MessageResponse>(MaintenanceModePage.url, body));
      this.success.set(res.message);
      await this.load(false);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Each row's switch as loaded (a row switched Down now is confirmed before saving). */
  private loaded = new Map<string, boolean>();

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    try {
      const rows = await firstValueFrom(this.http.get<MaintenanceRow[]>(MaintenanceModePage.url));
      this.loaded = new Map(rows.map((r) => [r.key, r.down]));
      this.rows.set(rows.map((r) => ({ ...r })));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
