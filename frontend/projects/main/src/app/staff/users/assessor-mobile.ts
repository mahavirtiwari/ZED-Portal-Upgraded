import { DatePipe } from '@angular/common';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ADMIN_PORTAL } from '../admin-portal';
import { STAFF_SYSTEM, StaffRole } from '../staff-menu';

/** The systems whose site assessor app has the one-phone rule (AssessorMobileController: Main and Surveillance). */
export type AssessorMobileSystem = 'main' | 'surveillance';

/** The phone registered for the assessor (Zed.Core.Mobile.RegisteredDevice; times are the server's local time). */
export interface AssessorDevice {
  deviceId: string;
  model: string | null;
  osVersion: string | null;
  firstSeenAt: string | null;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
}

/** A sign-in to the site assessor app (dbo.V4LoginEvents); `at` is UTC. */
export interface AssessorSignIn {
  at: string;
  result: string;
  reason: string | null;
  deviceId: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  appVersion: string | null;
  ipAddress: string | null;
}

export interface AssessorMobileResponse {
  userId: string;
  device: AssessorDevice | null;
  signIns: AssessorSignIn[];
}

/** Only the Admin and the MasterAdmin see and release an assessor's phone (the API's roles; never agencies). */
export function canSeeAssessorMobile(roleId: number | null | undefined): boolean {
  return roleId === StaffRole.Admin || roleId === StaffRole.MasterAdmin;
}

/** A UTC time sent without a zone ("2026-11-03T10:15:00") read as UTC, so it shows in the viewer's local time. */
export function asUtc(value: string | null): string | null {
  if (!value) return value;
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : value + 'Z';
}

/**
 * Admin → assessor → Registered mobile (V4): an assessor signs in to the site assessor app on one phone only; a sign-in
 * from another phone is refused. Shows the registered phone (make and model, Android version, registered on, last
 * sign-in and IP) and the assessor's recent app sign-ins (refused ones with their reason), and releases the phone when
 * the assessor changes or loses it: the next sign-in then registers the phone it comes from.
 * `system` picks the portal whose API is called (api/staff/assessor-mobile/{userId}); from the main build a Surveillance
 * assessor's calls go to the Surveillance portal's API through the Admin's hand-over (ADMIN_PORTAL).
 */
@Component({
  selector: 'zed-assessor-mobile',
  imports: [DatePipe],
  template: `
    <section class="am-card" [class.zed-card]="!plain()" aria-labelledby="am-title">
      <div class="am-head">
        <div class="am-intro">
          <h4 class="am-title" id="am-title">Registered mobile <span class="am-app">· site assessor app</span></h4>
          <p class="am-hint">{{ userId() }} can sign in only on this phone. Release it when the assessor changes or loses the phone.</p>
        </div>
        @if (data()?.device) {
          <button type="button" class="btn btn-outline-danger am-release" [disabled]="busy()" (click)="release()">Release phone</button>
        }
      </div>
      @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
      @if (message()) { <div class="alert alert-success" role="status">{{ message() }}</div> }

      @if (loading() && !data()) {
        <p class="muted am-loading" role="status">Loading…</p>
      } @else if (notAssessor()) {
        <p class="am-note">{{ userId() }} is not a site assessor of this portal.</p>
      } @else if (data(); as d) {
        @if (d.device; as dev) {
          <div class="am-tiles">
            <div class="am-tile"><span class="am-label">Make and model</span><span class="am-value">{{ dev.model || '—' }}</span></div>
            <div class="am-tile"><span class="am-label">Android</span><span class="am-value">{{ dev.osVersion || '—' }}</span></div>
            <div class="am-tile"><span class="am-label">Registered on</span>
              <span class="am-value">@if (dev.firstSeenAt) { {{ dev.firstSeenAt | date: 'dd-MM-yyyy' }} } @else { — }</span></div>
            <div class="am-tile"><span class="am-label">Last sign-in · IP</span>
              <span class="am-value">@if (dev.lastLoginAt) { {{ dev.lastLoginAt | date: 'dd-MM-yyyy HH:mm' }} } @else { — } · {{ dev.lastIp || '—' }}</span></div>
          </div>
        } @else {
          <p class="am-note">No mobile registered yet — the next sign-in registers the phone.</p>
        }

        <h5 class="am-sub">Recent sign-ins</h5>
        @if (d.signIns.length) {
          <div class="table-responsive">
            <table class="table table-zed table-bordered am-table">
              <thead><tr><th>When</th><th>Result</th><th>Phone</th><th>IP</th><th>App</th></tr></thead>
              <tbody>
                @for (s of d.signIns; track $index) {
                  <tr>
                    <td class="text-nowrap">{{ utc(s.at) | date: 'dd-MM-yyyy HH:mm' }}</td>
                    <td>
                      <span class="status-badge" [class.is-success]="s.result === 'Success'" [class.is-rejected]="s.result !== 'Success'">{{ s.result }}</span>
                      @if (s.result !== 'Success' && s.reason) { <small class="am-reason">{{ s.reason }}</small> }
                    </td>
                    <td>{{ s.deviceModel || '—' }}</td>
                    <td>{{ s.ipAddress || '—' }}</td>
                    <td>{{ s.appVersion || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="muted am-empty">No sign-ins yet.</p>
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .am-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px 16px; margin-bottom: 12px; }
    .am-intro { flex: 1 1 260px; min-width: 0; }
    .am-title { font-size: 16px; font-weight: 700; color: #23474a; margin: 0 0 4px; }
    .am-app { font-weight: 600; color: #5f6f70; }
    .am-hint { font-size: 13px; color: #5f6f70; margin: 0; overflow-wrap: anywhere; }
    .am-release { flex: none; }
    .am-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
    .am-tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid #dfe9ea; border-radius: 10px; background: #f7fbfb; min-width: 0; }
    .am-label { font-size: 12px; font-weight: 600; color: #5f6f70; }
    .am-value { font-size: 14px; font-weight: 600; color: #23474a; overflow-wrap: anywhere; }
    .am-note { margin: 0 0 16px; padding: 10px 12px; border-radius: 10px; background: #f6f8f8; font-size: 14px; color: #3b4b4c; }
    .am-sub { font-size: 14px; font-weight: 700; color: #23474a; margin: 0 0 8px; }
    .am-table { margin-bottom: 0; }
    .am-table td { vertical-align: middle; font-size: 13px; }
    .am-reason { display: block; margin-top: 2px; font-size: 12px; color: #a8303a; }
    .am-empty, .am-loading { margin: 0; font-size: 13px; }
    @media (max-width: 767.98px) {
      .am-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    }
  `,
})
export class AssessorMobilePanel {
  private readonly http = inject(HttpClient);
  private readonly own = inject(STAFF_SYSTEM);

  readonly userId = input.required<string>();
  /** The portal whose site assessor app the assessor signs in to. */
  readonly system = input<AssessorMobileSystem>('main');
  /** Without the card frame (inside a pop-up). */
  readonly plain = input(false);

  protected readonly data = signal<AssessorMobileResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly notAssessor = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly utc = asUtc;

  constructor() {
    effect(() => {
      this.userId();
      this.system();
      untracked(() => {
        this.message.set('');
        this.data.set(null);
        void this.load();
      });
    });
  }

  private get url(): string {
    return `/api/staff/assessor-mobile/${encodeURIComponent(this.userId())}`;
  }

  /** Another portal's API (from the main build: the Surveillance portal through the Admin's hand-over). */
  private get context(): HttpContext | undefined {
    return this.system() === this.own ? undefined : new HttpContext().set(ADMIN_PORTAL, this.system());
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.notAssessor.set(false);
    try {
      const r = await firstValueFrom(this.http.get<AssessorMobileResponse>(this.url, { context: this.context }));
      this.data.set({ ...r, signIns: r.signIns ?? [] });
    } catch (err) {
      this.data.set(null);
      if (err instanceof HttpErrorResponse && err.status === 404) this.notAssessor.set(true);
      else this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Releases the registered phone after a confirmation; the next sign-in registers the phone it comes from. */
  protected async release(): Promise<void> {
    const id = this.userId();
    if (!window.confirm(`Release the registered mobile of ${id}? The next sign-in will register the phone it comes from.`)) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      const r = await firstValueFrom(this.http.delete<MessageResponse>(this.url, { context: this.context }));
      this.message.set(r.message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
