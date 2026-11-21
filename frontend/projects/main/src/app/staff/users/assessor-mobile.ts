import { DatePipe } from '@angular/common';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { ADMIN_PORTAL } from '../admin-portal';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { STAFF_SYSTEM, StaffRole } from '../staff-menu';
import { ToastService } from '../toast';
import { asUtc } from '../utc-time';
import { PHONES_URL, releaseMobileAsk, releasePhone } from './assessor-phone';

/** The portals whose apps have the one-phone rule (AssessorMobileController): all three. */
export type AssessorMobileSystem = 'main' | 'surveillance' | 'consultancy';

/** A phone registered for the user in one app (times are the server's local time; null fields before migration 0099). */
export interface AssessorDevice {
  app?: string | null;
  appName?: string | null;
  deviceId: string;
  model: string | null;
  make?: string | null;
  osVersion: string | null;
  apiLevel?: number | null;
  appVersion?: string | null;
  firstSeenAt: string | null;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  firstIp?: string | null;
}

/** A sign-in to the app (dbo.V4LoginEvents); `at` is UTC. */
export interface AssessorSignIn {
  at: string;
  app?: string | null;
  result: string;
  reason: string | null;
  deviceId: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  appVersion: string | null;
  ipAddress: string | null;
}

/** A released phone (dbo.MobileDeviceEvents, Outcome Released); `at` is server time. */
export interface MobileRelease {
  at: string;
  app: string | null;
  deviceId: string | null;
  model: string | null;
  releasedBy: string | null;
  reason: string | null;
  ip: string | null;
}

export interface AssessorMobileResponse {
  userId: string;
  device: AssessorDevice | null;
  devices?: AssessorDevice[];
  signIns: AssessorSignIn[];
  releases?: MobileRelease[];
  refusedToday?: boolean;
}

/** Only the Admin and the MasterAdmin see and release a user's phone (the API's roles; never agencies). */
export function canSeeAssessorMobile(roleId: number | null | undefined): boolean {
  return roleId === StaffRole.Admin || roleId === StaffRole.MasterAdmin;
}

/** A UTC time sent without a zone read as UTC (moved to the shared utc-time.ts on 2026-11-19; kept here for its callers). */
export { asUtc } from '../utc-time';

/** "Android 13 · API 33". */
export function osLine(d: AssessorDevice): string {
  const os = d.osVersion?.trim();
  return [os ? (/^\d/.test(os) ? 'Android ' + os : os) : '', d.apiLevel ? 'API ' + d.apiLevel : ''].filter(Boolean).join(' · ') || '—';
}

/** Sign-ins shown before "Show all". */
const SHOWN = 5;

/**
 * Registered mobile (V4; 2026-11-18 on every portal, the user: "Master admin will release the mobile then assessor can use new
 * one"): an assessor or consultant signs in to the app on one phone only; a sign-in from another phone is refused until the
 * Admin or the Master Admin releases it. The card of the details page's right rail (and of the Surveillance list's pop-up):
 * the registered phone (make and model, Android and API level, app version, registered on, last sign-in and IP, first IP),
 * Release Mobile (a reason is required), a refusal today, the recent sign-ins (refused ones with reason and IP) and the
 * release history. `system` picks the portal whose API is called (api/staff/assessor-mobile/{userId}); from the main build
 * another portal's calls go through the Admin's hand-over (ADMIN_PORTAL).
 */
@Component({
  selector: 'zed-assessor-mobile',
  imports: [DatePipe, ConfirmDialog, TextPipe],
  template: `
    <section class="am" [class.zed-card]="!plain()" aria-labelledby="am-title" data-rail="mobile">
      <h4 class="am-head" id="am-title">
        <span class="am-tile" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2" /></svg></span>
        {{ 'Registered mobile' | t: 'staff.assessorMobile.title' }}
        @if (devices().length) {
          <button type="button" class="btn btn-outline-danger am-release" [disabled]="busy()" (click)="askRelease()">{{ 'Release Mobile' | t: 'staff.assessorMobile.releaseButton' }}</button>
        }
      </h4>
      <div class="am-body">
        @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
        @if (loading() && !data()) {
          <p class="am-muted" role="status">{{ 'Loading…' | t: 'staff.assessorMobile.loading' }}</p>
        } @else if (notAssessor()) {
          <p class="am-note">{{ '{id} does not use an app of this portal.' | t: 'staff.assessorMobile.notAppUser' : { id: userId() } }}</p>
        } @else if (data(); as d) {
          @if (d.refusedToday) { <p class="am-note is-warn" data-refused>{{ 'A sign-in from another phone was refused today.' | t: 'staff.assessorMobile.refusedNote' }}</p> }
          @for (dev of devices(); track dev.deviceId) {
            @if (devices().length > 1 || dev.appName) { <p class="am-app">{{ dev.appName || dev.app }}</p> }
            <dl class="am-facts">
              <div class="am-wide"><dt>{{ 'Make and model' | t: 'staff.assessorMobile.fact.modelLabel' }}</dt><dd>{{ dev.model || dev.make || '—' }}</dd></div>
              <div><dt>{{ 'OS' | t: 'staff.assessorMobile.fact.osLabel' }}</dt><dd>{{ os(dev) }}</dd></div>
              <div><dt>{{ 'App version' | t: 'staff.assessorMobile.fact.appVersionLabel' }}</dt><dd>{{ dev.appVersion || '—' }}</dd></div>
              <div><dt>{{ 'Registered on' | t: 'staff.assessorMobile.fact.registeredOnLabel' }}</dt><dd>@if (dev.firstSeenAt) { {{ dev.firstSeenAt | date: 'dd-MM-yyyy' }} } @else { — }</dd></div>
              <div><dt>{{ 'Last sign-in' | t: 'staff.assessorMobile.fact.lastSignInLabel' }}</dt><dd>@if (dev.lastLoginAt) { {{ dev.lastLoginAt | date: 'dd-MM-yyyy HH:mm' }} } @else { — }</dd></div>
              <div class="am-wide"><dt>{{ 'IP address' | t: 'staff.assessorMobile.fact.ipLabel' }}</dt><dd>{{ dev.lastIp || '—' }}@if (dev.firstIp && dev.firstIp !== dev.lastIp) { <small> · {{ 'first {ip}' | t: 'staff.assessorMobile.fact.firstIp' : { ip: dev.firstIp } }}</small> }</dd></div>
            </dl>
          } @empty {
            <p class="am-note">{{ 'Not registered: the next sign-in registers the phone it comes from.' | t: 'staff.assessorMobile.notRegistered' }}</p>
          }
          <p class="am-hint">{{ '{id} can sign in only on the registered phone. Release it when the phone is changed or lost.' | t: 'staff.assessorMobile.hint' : { id: userId() } }}</p>

          <h5 class="am-sub">{{ 'Recent sign-ins' | t: 'staff.assessorMobile.signIns.title' }}</h5>
          @if (d.signIns.length) {
            <ul class="am-list">
              @for (s of shownSignIns(); track $index) {
                <li [class.is-bad]="s.result !== 'Success'">
                  <span class="am-when">{{ utc(s.at) | date: 'dd-MM-yyyy HH:mm' }}</span>
                  <span class="status-badge" [class.is-active]="s.result === 'Success'" [class.is-rejected]="s.result !== 'Success'">{{ s.result === 'Success' ? ('Signed in' | t: 'staff.assessorMobile.signIns.ok') : ('Refused' | t: 'staff.assessorMobile.signIns.refused') }}</span>
                  @let sm = s.deviceModel || ('Phone not sent' | t: 'staff.assessorMobile.signIns.noModel');
                  @let sip = s.ipAddress || ('IP not known' | t: 'staff.assessorMobile.signIns.noIp');
                  <span class="am-line">{{ s.appVersion ? ('{model} · {ip} · app {version}' | t: 'staff.assessorMobile.signIns.lineApp' : { model: sm, ip: sip, version: s.appVersion })
                    : ('{model} · {ip}' | t: 'staff.assessorMobile.signIns.line' : { model: sm, ip: sip }) }}</span>
                  @if (s.result !== 'Success' && s.reason) { <small class="am-reason">{{ s.reason }}</small> }
                </li>
              }
            </ul>
            @if (d.signIns.length > shown) {
              <button type="button" class="btn btn-link am-more" (click)="all.set(!all())">{{ all() ? ('Show less' | t: 'staff.assessorMobile.signIns.lessButton') : ('Show all {count}' | t: 'staff.assessorMobile.signIns.allButton' : { count: d.signIns.length }) }}</button>
            }
          } @else {
            <p class="am-muted">{{ 'No sign-ins yet.' | t: 'staff.assessorMobile.signIns.empty' }}</p>
          }

          <h5 class="am-sub">{{ 'Release history' | t: 'staff.assessorMobile.releases.title' }}</h5>
          @if (d.releases?.length) {
            <ul class="am-list" data-releases>
              @for (r of d.releases; track $index) {
                <li>
                  <span class="am-when">{{ r.at | date: 'dd-MM-yyyy HH:mm' }}</span>
                  <span class="am-line">{{ '{model} released by {by}' | t: 'staff.assessorMobile.releases.line' : { model: r.model || ('Phone' | t: 'staff.assessorMobile.releases.noModel'), by: r.releasedBy || '—' } }}</span>
                  @if (r.reason) { <small class="am-why">“{{ r.reason }}”</small> }
                </li>
              }
            </ul>
          } @else {
            <p class="am-muted">{{ 'Never released.' | t: 'staff.assessorMobile.releases.empty' }}</p>
          }
        }
      </div>
    </section>
    @if (ask(); as a) {
      <zed-confirm-dialog [ask]="a" [busy]="busy()" [failed]="failed()" inputId="am-release-reason" (confirmed)="release($event)" (cancel)="closeRelease()" />
    }
  `,
  styles: `
    /* 2026-11-21 (Consultancy audit: the card overflowed the page at 390 px on a long OS string). */
    :host { display: block; min-width: 0; max-width: 100%; }
    .am { padding: 0; overflow: hidden; margin-bottom: 20px; min-width: 0; }
    .am-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0; padding: 13px 20px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; color: #17373b; }
    .am-tile { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #e6f2f3; color: #24666b; }
    .am-tile svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .am-release { margin-left: auto; min-height: 32px; padding: 4px 12px; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
    .am-body { padding: 14px 20px 18px; }
    .am-app { margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #24666b; }
    .am-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin: 0 0 12px; }
    .am-facts > div { min-width: 0; }
    @media (max-width: 420px) { .am-facts { grid-template-columns: minmax(0, 1fr); } .am-release { margin-left: 0; } }
    .am-facts .am-wide { grid-column: 1 / -1; }
    .am-facts dt { font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: #6f8487; }
    .am-facts dd { margin: 2px 0 0; font-size: 13.5px; font-weight: 600; color: #17373b; overflow-wrap: anywhere; }
    .am-facts small { font-weight: 500; color: #6f8487; }
    .am-note { margin: 0 0 12px; padding: 9px 12px; border-radius: 9px; background: #f2f6f6; font-size: 13px; color: #3d5559; }
    .am-note.is-warn { background: #fdf2dc; color: #7a4b05; font-weight: 600; }
    .am-hint { margin: 0 0 4px; font-size: 12px; color: #6f8487; overflow-wrap: anywhere; }
    .am-sub { margin: 14px 0 6px; font-size: 13px; font-weight: 700; color: #17373b; }
    .am-list { list-style: none; margin: 0; padding: 0; }
    .am-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding: 7px 0; border-top: 1px solid #edf2f2; font-size: 12.5px; }
    .am-when { font-weight: 600; color: #17373b; white-space: nowrap; }
    .am-list .status-badge { font-size: 10.5px; }
    .am-line { flex-basis: 100%; color: #3d5559; overflow-wrap: anywhere; }
    .am-reason, .am-why { flex-basis: 100%; font-size: 12px; overflow-wrap: anywhere; }
    .am-reason { color: #a8303a; }
    .am-why { color: #6f8487; }
    .am-more { padding: 0; font-size: 12.5px; font-weight: 700; }
    .am-muted { margin: 0; font-size: 12.5px; color: #6f8487; }
  `,
})
export class AssessorMobilePanel {
  private readonly http = inject(HttpClient);
  private readonly own = inject(STAFF_SYSTEM);
  private readonly toast = inject(ToastService);

  readonly userId = input.required<string>();
  /** The portal whose app the user signs in to. */
  readonly system = input<AssessorMobileSystem>('main');
  /** Without the card frame (inside a pop-up). */
  readonly plain = input(false);
  /** The user's name, for the release pop-up. */
  readonly name = input<string | null>(null);
  /** "assessor" or "consultant", for the release pop-up; empty: the standard "assessor". */
  readonly word = input('');
  /** After a release (a list refreshes its Phone chip). */
  readonly released = output<string>();

  protected readonly data = signal<AssessorMobileResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly notAssessor = signal(false);
  protected readonly error = signal('');
  protected readonly failed = signal('');
  protected readonly ask = signal<ConfirmAsk | null>(null);
  protected readonly all = signal(false);
  protected readonly shown = SHOWN;
  protected readonly utc = asUtc;
  protected readonly os = osLine;
  protected readonly devices = computed(() => {
    const d = this.data();
    return d?.devices?.length ? d.devices : d?.device ? [d.device] : [];
  });
  protected readonly shownSignIns = computed(() => {
    const list = this.data()?.signIns ?? [];
    return this.all() ? list : list.slice(0, SHOWN);
  });

  constructor() {
    effect(() => {
      this.userId();
      this.system();
      untracked(() => {
        this.data.set(null);
        this.all.set(false);
        void this.load();
      });
    });
  }

  private get url(): string {
    return `${PHONES_URL}/${encodeURIComponent(this.userId())}`;
  }

  /** Another portal's API (from the main build: through the Admin's hand-over). */
  private get context(): HttpContext | undefined {
    return this.system() === this.own ? undefined : new HttpContext().set(ADMIN_PORTAL, this.system());
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.notAssessor.set(false);
    try {
      const r = await firstValueFrom(this.http.get<AssessorMobileResponse>(this.url, { context: this.context }));
      this.data.set({ ...r, signIns: r.signIns ?? [], releases: r.releases ?? [] });
    } catch (err) {
      this.data.set(null);
      if (err instanceof HttpErrorResponse && err.status === 404) this.notAssessor.set(true);
      else this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected askRelease(): void {
    this.failed.set('');
    const model = this.devices().map((d) => d.model || d.make).find(Boolean);
    this.ask.set(releaseMobileAsk(this.name(), this.userId(), model, this.word() || t('staff.assessorMobile.word', 'assessor')));
  }

  protected closeRelease(): void {
    if (!this.busy()) this.ask.set(null);
  }

  /** Releases the registered phone with the reason; the next sign-in registers the phone it comes from. */
  protected async release(reason: string): Promise<void> {
    this.busy.set(true);
    this.failed.set('');
    try {
      const r = await firstValueFrom(releasePhone(this.http, this.userId(), reason, this.context));
      this.busy.set(false);
      this.ask.set(null);
      this.toast.success(t('staff.assessorMobile.toast.released', 'Mobile released'), r.message);
      this.released.emit(this.userId());
      await this.load();
    } catch (err) {
      this.failed.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
