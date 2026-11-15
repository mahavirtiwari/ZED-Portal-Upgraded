import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';

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
  imports: [FormsModule, PageHead],
  template: `
    <zed-page-head title="Maintenance mode" [crumbs]="[{ label: 'All settings', link: '/staff/administration' }, { label: 'Maintenance mode' }]" />
    <p class="page-sub mm-sub">Take a portal or app down for work. The Admin can always sign in on the main portal.</p>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }

    <form class="zed-card mm-card" (ngSubmit)="save()" novalidate>
      <div class="table-responsive">
        <table class="table table-zed mm-table">
          <thead>
            <tr><th>Portal / app</th><th class="text-center">State</th><th>Message shown to users</th><th>Window (optional)</th></tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.key) {
              <tr [class.is-down]="r.down || r.downNow">
                <td data-label="Portal / app">
                  <strong>{{ r.name }}</strong>
                  @if (r.downNow) { <span class="mm-now">Down now</span> }
                </td>
                <td class="text-center" data-label="State">
                  <label class="mm-switch" [class.down]="r.down">
                    <input type="checkbox" role="switch" [name]="'down-' + r.key" [attr.aria-label]="r.name + ' down'" [(ngModel)]="r.down" />
                    <span class="mm-track" aria-hidden="true"></span>{{ r.down ? 'Down' : 'Up' }}
                  </label>
                </td>
                <td data-label="Message">
                  <input class="form-control" [name]="'message-' + r.key" maxlength="300" [placeholder]="r.defaultMessage"
                         [attr.aria-label]="'Message of ' + r.name" [(ngModel)]="r.message" />
                </td>
                <td data-label="Window">
                  <div class="mm-window">
                    <input type="datetime-local" class="form-control" [name]="'from-' + r.key" [attr.aria-label]="r.name + ' down from'" [(ngModel)]="r.from" />
                    <span class="muted">to</span>
                    <input type="datetime-local" class="form-control" [name]="'until-' + r.key" [attr.aria-label]="r.name + ' up again at'" [(ngModel)]="r.until" />
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted mm-note">
        Down: the portal shows a maintenance page with the message (users signed in see it on their next click); the app shows the
        message instead of its screens. With a window, it goes down at the start and comes up at the end by itself; switched Down
        with only an end, it comes up at the end. Payments already started still complete.
      </p>
      <div class="mm-actions">
        <button type="submit" class="btn btn-primary" [disabled]="busy()">Save</button>
      </div>
    </form>
    @if (busy()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .mm-sub { margin: -8px 0 14px; color: #5f6f70; }
    .mm-card { padding: 16px; }
    .mm-table td { vertical-align: middle; }
    .mm-table tr.is-down td { background: #fdf6f5; }
    .mm-now { display: inline-block; margin-left: 8px; font-size: 11.5px; font-weight: 700; color: #b03a2e; background: #fbe4e1; border-radius: 4px; padding: 1px 7px; }
    .mm-switch { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; font-weight: 600; color: #1e7a3c; cursor: pointer; text-transform: none; }
    .mm-switch.down { color: #b03a2e; }
    .mm-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .mm-track { position: relative; width: 34px; height: 18px; border-radius: 10px; background: #45a5ad; flex: none; transition: background .15s; }
    .mm-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .15s; }
    .mm-switch.down .mm-track { background: #d9776b; }
    .mm-switch.down .mm-track::after { left: 18px; }
    .mm-switch input:focus-visible + .mm-track { outline: 2px solid #23656b; outline-offset: 2px; }
    .mm-window { display: flex; align-items: center; gap: 6px; }
    .mm-window .form-control { min-width: 0; }
    .mm-note { font-size: 13px; margin: 8px 0 0; }
    .mm-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
    @media (max-width: 991.98px) { .mm-window { flex-wrap: wrap; } }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class MaintenanceModePage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/maintenance';
  protected readonly rows = signal<MaintenanceRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected async save(): Promise<void> {
    const down = this.rows().filter((r) => r.down && !this.loaded.get(r.key));
    if (down.length && !confirm(`Take ${down.map((r) => r.name).join(', ')} down now? Its users see the maintenance message.`)) return;
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
