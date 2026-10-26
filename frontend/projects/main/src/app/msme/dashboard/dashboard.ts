import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { PaymentStep } from '../payment/payment-step';

type Row = Record<string, string | number | boolean | null>;

interface DashboardData {
  msme: Row;
  basicInfo: Row;
  certStatus: Row;
}

type Level = 'Bronze' | 'Silver' | 'Gold';
type InfoTopic = Level | 'My' | 'MyIncentives';
type Modal = { kind: 'apply-info'; level: Level } | { kind: 'info'; topic: InfoTopic } | { kind: 'joining' } | { kind: 'fa' } | { kind: 'tu' };

/** Stepper on each certification card: [completed when status >, current when status in (from, to]]. */
interface StepRule {
  doneAbove: number;
  currentFrom: number;
  currentTo: number;
}

const STEPS: Record<Level, StepRule[]> = {
  Bronze: [
    { doneAbove: 1, currentFrom: 0, currentTo: 1 },
    { doneAbove: 4, currentFrom: 1, currentTo: 4 },
    { doneAbove: 5, currentFrom: 4, currentTo: 5 },
  ],
  Silver: [
    { doneAbove: 1, currentFrom: 0, currentTo: 1 },
    { doneAbove: 5, currentFrom: 1, currentTo: 5 },
    { doneAbove: 14, currentFrom: 6, currentTo: 14 },
    { doneAbove: 15, currentFrom: 14, currentTo: 15 },
  ],
  Gold: [
    { doneAbove: 1, currentFrom: 0, currentTo: 1 },
    { doneAbove: 5, currentFrom: 1, currentTo: 5 },
    { doneAbove: 14, currentFrom: 6, currentTo: 14 },
    { doneAbove: 15, currentFrom: 14, currentTo: 15 },
  ],
};

/** Status code meaning "certified" per level (MsmeCertifications.CertificationStatus). */
const COMPLETED: Record<Level, number> = { Bronze: 6, Silver: 16, Gold: 16 };

/** The old page showed Bronze re-certification to this one pilot unit only; kept as is. */
const BRONZE_RECERT_PILOT = ['ZEDMSME1062064'];

/**
 * MSME dashboard. Port of Views/Msme/Dashboard.cshtml: unit summary, certification cards,
 * incentives, certification steps, the information pop-ups and the first two steps of applying
 * (disclaimer, instructions, payment).
 */
@Component({
  selector: 'zed-msme-dashboard',
  imports: [RouterLink, PaymentStep, DatePipe, ContentTextComponent],
  templateUrl: './dashboard.html',
  styleUrl: '../shared/msme-page.scss',
  styles: `
    .panel-incen-block > .panel-heading { background: #fff; border: 0; }
    /* The three level cards side by side, equal height; the sub-rows (surveillance, re-certification) no longer scroll. */
    .dashbord-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
    .dashbord-list .panel-cert-block { height: 100%; min-height: 160px; overflow: visible; background: rgba(179, 224, 121, 0.2); border: 0; }
    .dashbord-list .panel-cert-block > .panel-heading h5 { margin: 0; font-size: 14px; font-weight: 700; }
    .dashbord-list .cert-inner-block { padding: 10px 12px; gap: 10px; justify-content: space-between; }
    .dashbord-list .cert-inner-block .inner1 { flex: 1 1 auto; min-width: 0; }
    .dashbord-list .cert-inner-block .inner1 h5 { margin-bottom: 0; }
    .dashbord-list .cert-inner-block .inner1 h5 a { color: inherit; text-decoration: none; }
    .dashbord-list .cert-inner-block .inner2 img { width: 64px; padding: 0 8px 0 0; }
    .dashbord-list .sub-inner-block { padding-top: 8px; padding-bottom: 8px; }
    /* Incentive cards in a grid of equal-height tiles. */
    .panel-incen-box { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
    .panel-incen-box .item { width: auto; margin: 0; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); border-color: #dfe9ea; border-radius: 12px; }
    .panel-incen-box .panel-incen-block { height: 100%; border-radius: 12px; }
    .panel-incen-box .panel-incen-block .panel-heading { padding: 16px 16px 0; align-items: center; }
    .panel-incen-box .panel-incen-block .panel-heading > img { width: 90px; height: 72px; object-fit: contain; }
    .panel-incen-box .panel-incen-block .panel-body { padding: 12px 16px 16px; }
    .panel-incen-box .panel-incen-block .panel-body h4 { font-size: 16px; margin-bottom: 6px; }
    /* The three parts of the disclaimer read as one list. */
    .disclaimer-points > zed-text:not(:last-child) ::ng-deep ol { margin-bottom: 0; padding-bottom: 0; }
    .apply-btn, .clickable { cursor: pointer; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class DashboardPage {
  private readonly http = inject(HttpClient);

  protected readonly data = signal<DashboardData | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly refreshedAt = signal(new Date());
  protected readonly legacyUrl = signal('');
  /** "Back to UBP" after a hand-over from the Udyami Bharat portal (set by msme/udyami-signin). */
  protected readonly ubpReturnUrl = readUbpReturnUrl();

  protected readonly step = signal<'home' | 'disclaimer' | 'instructions' | 'payment'>('home');
  protected readonly applyLevel = signal<Level>('Bronze');
  protected readonly modal = signal<Modal | null>(null);

  protected readonly msme = computed(() => this.data()?.msme ?? {});
  protected readonly basic = computed(() => this.data()?.basicInfo ?? {});
  protected readonly cert = computed(() => this.data()?.certStatus ?? {});
  protected readonly levels: Level[] = ['Bronze', 'Silver', 'Gold'];

  /** Served by the authorised files endpoint (the old page linked to a public, guessable URL). */
  protected readonly pledgeCertificateUrl = '/api/msme/files/pledge-certificate';

  protected readonly incentives = [
    { type: 'Common', title: 'Ministry of MSME', text: 'Incentives by MoMSME through its schemes, for ZED Certified MSMEs', image: '/Images/Dashboard/dash-msme.PNG', imageStyle: 'width: 140px; height: 90px; object-fit: contain;' },
    { type: 'States', title: 'States/UTs', text: 'Incentives by States/UTs for ZED Certified MSMEs', image: '/Images/Dashboard/stateUts.png', imageStyle: null },
    { type: 'Financial', title: 'Financial Institutions', text: 'Incentives by Financial Institutions for ZED Certified MSMEs', image: '/Images/Dashboard/financial-Institution.png', imageStyle: null },
    { type: 'Other', title: 'Other Incentives', text: 'Incentives by Central Ministries/Other Organisations for ZED Certified MSMEs', image: '/Images/Dashboard/incentive.png', imageStyle: null },
  ] as const;

  /** The keys of the steps' texts (Admin → Texts). */
  protected readonly certificationSteps = [1, 2, 3, 4, 5].map((n) => `msme.dashboard.certificationSteps.${n}`);

  /** True once any level is certified; unlocks most incentives. */
  protected readonly anyCertified = computed(() =>
    this.num('BronzeStatus') === 6 || this.num('SilverStatus') === 16 || this.num('GoldStatus') === 16,
  );

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await firstValueFrom(this.http.get<DashboardData>('/api/msme/dashboard')));
      this.refreshedAt.set(new Date());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  // ----- helpers used by the template -----

  protected num(field: string, row: Row = this.cert()): number {
    const v = row[field];
    return typeof v === 'number' ? v : Number(v ?? 0) || 0;
  }

  /** Loose equality like the AngularJS expressions (null/undefined never equal a number). */
  protected is(row: Row, field: string, value: number): boolean {
    const v = row[field];
    return v !== null && v !== undefined && Number(v) === value;
  }

  protected status(level: Level): number {
    return this.num(`${level}Status`);
  }

  protected paid(level: Level): boolean {
    return this.is(this.msme(), `Is${level}PaymentDone`, 1);
  }

  protected statusLabel(level: Level): string {
    const s = this.status(level);
    if (s === 0) return 'Get started';
    if (s === COMPLETED[level]) return 'Completed';
    return s > 0 && s < COMPLETED[level] ? 'In-progress' : '';
  }

  protected stepClass(level: Level, rule: StepRule): string {
    const s = this.status(level);
    if (s > rule.doneAbove) return 'completed';
    if (rule.currentFrom === 0 ? s === 1 : s > rule.currentFrom && s <= rule.currentTo) return 'current';
    return '';
  }

  protected steps(level: Level): StepRule[] {
    return STEPS[level];
  }

  /**
   * Cards are greyed out while another level is in progress or already certified
   * (same conditions as the old page).
   */
  protected levelDisabled(level: Level): boolean {
    const b = this.status('Bronze'), s = this.status('Silver'), g = this.status('Gold');
    switch (level) {
      case 'Bronze':
        return (b < 1 && s > 0 && (s <= 16 || s === 17)) || (b < 1 && g > 0 && g <= 16) || g === 16 || s === 16 || g === 17;
      case 'Silver':
        return (s < 1 && b > 0 && (b < 6 || b === 7)) || (s < 1 && g > 0 && g <= 16) || g === 16 || g === 17;
      case 'Gold':
        return (g < 1 && s > 0 && (s < 16 || s === 17)) || (g < 1 && b > 0 && (b < 6 || b === 7));
    }
  }

  protected surveillanceVisible(level: Level): boolean {
    return !this.is(this.msme(), `${level}DashboardSurStatus`, 0);
  }

  protected surveillancePaid(level: Level): boolean {
    return !!this.msme()[`IsSur${level}PaymentDone`];
  }

  protected reCertificationVisible(level: Level): boolean {
    const b = this.basic();
    const pilotOk = level !== 'Bronze' || BRONZE_RECERT_PILOT.includes(String(this.msme()['ZedId']));
    return this.is(b, 'ReCertification', 1) && b['ReCertificationLevel'] === level && pilotOk;
  }

  protected legacy(path: string): string {
    return `${this.legacyUrl()}${path}`;
  }

  /** Query of the public incentive list (/incentives), as the old Incentive/Details link carried it. */
  protected incentiveQuery(type: 'Common' | 'States' | 'Financial' | 'Other'): Record<string, string> {
    const q: Record<string, string> = { it: type, ct: String(this.msme()['LatestCertification'] ?? '') };
    if (type === 'States') q['id'] = String(this.msme()['StateId'] ?? '');
    return q;
  }

  protected technologies(): string[] {
    return String(this.cert()['TuCertificationCategory'] ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // ----- actions -----

  protected open(modal: Modal): void {
    this.modal.set(modal);
  }

  protected apply(level: Level): void {
    this.applyLevel.set(level);
    this.goStep('disclaimer');
  }

  protected goStep(step: 'home' | 'disclaimer' | 'instructions' | 'payment'): void {
    this.step.set(step);
    window.scrollTo(0, 0);
  }

  protected infoTitle(topic: InfoTopic): string {
    return topic === 'MyIncentives' ? 'My Incentives' : `${topic} Certification`;
  }
}

function readUbpReturnUrl(): string | null {
  try {
    return sessionStorage.getItem('zed.ubpReturnUrl');
  } catch {
    return null;
  }
}
