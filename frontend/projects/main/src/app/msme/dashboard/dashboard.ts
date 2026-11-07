import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientConfigService, PortalLinksService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentService, ContentTextComponent } from '../../content/content-text';
import { PaymentStep } from '../payment/payment-step';
import { levelLogo, levelName } from '../shared/levels';
import { isWebEntryLevel } from '../entry/entry.api';

type Row = Record<string, string | number | boolean | null>;

interface DashboardData {
  msme: Row;
  basicInfo: Row;
  certStatus: Row;
}

/** ZEDX is ZED-X (Administration → Certification Levels), shown once the Admin enables it. */
type Level = 'Bronze' | 'Silver' | 'Gold' | 'ZEDX';
const KNOWN_LEVELS: readonly Level[] = ['Bronze', 'Silver', 'Gold', 'ZEDX'];

/** A level as the Admin set it (api/public/levels: enabled ones only). */
interface PublicLevel {
  code: string;
  name: string;
  description: string | null;
  comment: string | null;
  logoUrl: string | null;
  assessmentMode: 'Desktop' | 'Site';
  validityMonths: number;
  fee: number | null;
  /** When surveillance falls due; null without surveillance. */
  surveillance?: { firstDueMonths: number; count: number | null; intervalMonths: number | null } | null;
}
type InfoTopic = Level | 'My' | 'MyIncentives';
type Modal = { kind: 'apply-info'; level: Level } | { kind: 'info'; topic: InfoTopic } | { kind: 'joining' } | { kind: 'fa' } | { kind: 'tu' }
  | { kind: 'incentive'; card: IncentiveCard };

/** A built-in card of "My Incentives" as the Admin set it (Admin → Incentives → Main Dashboard Cards). */
interface BuiltInCard {
  card: string;
  title: string | null;
  highlight: string | null;
  details: string | null;
  active: boolean;
}

/** An incentive the Admin put on the dashboard ("Where it appears": Main dashboard). */
export interface IncentiveCard {
  id: number;
  title: string | null;
  highlight: string | null;
  details: string | null;
  department: string | null;
  contactPerson: string | null;
  email: string | null;
  mobileNo: string | null;
  webLink: string | null;
  videoLink: string | null;
  applicableForBronze: boolean;
  applicableForSilver: boolean;
  applicableForGold: boolean;
}

/** The built-in cards' wording before V4 (until the server answers, or before migration 0026). */
const BUILT_IN_DEFAULTS: Record<string, BuiltInCard> = Object.fromEntries(
  ([
    ['JOINING_REWARD', 'Joining Reward', 'Rs. 10,000/-', 'Limited purpose reward, linked with ZED Certification Levels'],
    ['FINANCIAL_ASSISTANCE', 'Financial Assistance', '75% of Subsidy (Max. Rs. 50,000/-)', 'For System Certification or Product Certification or Product Testing'],
    ['HANDHOLDING', 'Handholding Support', 'Cost: Rs. 2,00,000/- (Subsidy as per MSME size)', 'for improving systems and processes'],
    ['TECHNOLOGY_UPGRADATION', 'Technology Upgradation', 'Support of upto Rs. 3,00,000/-', 'for moving towards Zero Effect Solutions'],
  ] as const).map(([card, title, highlight, details]) => [card, { card, title, highlight, details, active: true }]),
);

/** Stepper on each certification card: [completed when status >, current when status in (from, to]]. */
interface StepRule {
  doneAbove: number;
  currentFrom: number;
  currentTo: number;
  /** Shown under the step's dot (2026-11-07). */
  label: string;
}

const STEPS: Record<Level, StepRule[]> = {
  Bronze: [
    { doneAbove: 1, currentFrom: 0, currentTo: 1, label: 'Details' },
    { doneAbove: 4, currentFrom: 1, currentTo: 4, label: 'Assessment' },
    { doneAbove: 5, currentFrom: 4, currentTo: 5, label: 'Certified' },
  ],
  Silver: [
    { doneAbove: 1, currentFrom: 0, currentTo: 1, label: 'Details' },
    { doneAbove: 5, currentFrom: 1, currentTo: 5, label: 'Desktop' },
    { doneAbove: 14, currentFrom: 6, currentTo: 14, label: 'Site visit' },
    { doneAbove: 15, currentFrom: 14, currentTo: 15, label: 'Certified' },
  ],
  Gold: [
    { doneAbove: 1, currentFrom: 0, currentTo: 1, label: 'Details' },
    { doneAbove: 5, currentFrom: 1, currentTo: 5, label: 'Desktop' },
    { doneAbove: 14, currentFrom: 6, currentTo: 14, label: 'Site visit' },
    { doneAbove: 15, currentFrom: 14, currentTo: 15, label: 'Certified' },
  ],
  // ZED-X: desktop and site assessment, the statuses of the site levels.
  ZEDX: [
    { doneAbove: 1, currentFrom: 0, currentTo: 1, label: 'Details' },
    { doneAbove: 5, currentFrom: 1, currentTo: 5, label: 'Desktop' },
    { doneAbove: 14, currentFrom: 6, currentTo: 14, label: 'Site visit' },
    { doneAbove: 15, currentFrom: 14, currentTo: 15, label: 'Certified' },
  ],
};

/** Status code meaning "certified" per level (MsmeCertifications.CertificationStatus). */
const COMPLETED: Record<Level, number> = { Bronze: 6, Silver: 16, Gold: 16, ZEDX: 16 };

/**
 * MSME dashboard. Port of Views/Msme/Dashboard.cshtml: unit summary, certification cards,
 * incentives, certification steps, the information pop-ups and the first two steps of applying
 * (disclaimer, instructions, payment). V4 layout: the unit in one band at the top (no side bar), and a larger card per
 * level, all in one row on wide screens, with its validity, surveillance and fee (Administration → Certification Levels),
 * its status above a progress bar, and its two buttons side by side.
 */
@Component({
  selector: 'zed-msme-dashboard',
  imports: [RouterLink, PaymentStep, DatePipe, ContentTextComponent],
  templateUrl: './dashboard.html',
  styleUrl: '../shared/msme-page.scss',
  styles: `
    .panel-incen-block > .panel-heading { background: #fff; border: 0; }
    /* The unit band (in place of the live page's side bar). */
    .unit-band { display: flex; align-items: center; gap: 16px; padding: 16px 20px; margin-bottom: 16px; background: linear-gradient(90deg, #eef8f6, #f7fbfb 60%, #fff);
      border: 1px solid #dfe9ea; border-radius: 14px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); }
    .ent { flex: 0 0 64px; height: 64px; border-radius: 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1;
      background: #eef6f6; color: #23474a; }
    .ent b { font-size: 26px; }
    .ent small { font-size: 9.5px; font-weight: 700; letter-spacing: .08em; margin-top: 3px; }
    /* The enterprise type's colours of the live page (Micro / Small / Medium). */
    .ent-micro { background: #F6CB8B; color: #6b4d00; }
    .ent-small { background: #E6E96E; color: #575a00; }
    .ent-medium { background: #A9DBEB; color: #1d4f5e; }
    .unit-name { flex: 1 1 auto; min-width: 0; }
    .unit-name h4 { margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #23474a; overflow-wrap: anywhere; }
    .unit-ids { display: flex; flex-wrap: wrap; gap: 8px; }
    .id-tag { display: inline-flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #dfe9ea; border-radius: 8px; padding: 4px 10px;
      font-size: 13.5px; font-weight: 600; color: #232527; letter-spacing: .02em; }
    .id-tag i { font-style: normal; font-size: 10.5px; font-weight: 700; color: #2f7c83; background: #eef6f6; border-radius: 4px; padding: 1px 6px; letter-spacing: .05em; }
    .pledge-box { flex: none; display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #cfe7d6; border-radius: 12px; padding: 10px 12px; }
    .pledge-box .seal { width: 34px; height: 34px; border-radius: 17px; background: #2e9e5b; color: #fff; display: grid; place-items: center; font-weight: 800; }
    .pledge-box small { display: block; font-size: 11.5px; color: #5f6f70; }
    .pledge-box b { font-size: 14px; color: #232527; }
    .pledge-box .btn { white-space: nowrap; }
    @media (max-width: 767.98px) {
      .unit-band { flex-wrap: wrap; }
      .pledge-box { width: 100%; }
      .pledge-box .btn { margin-left: auto; }
    }

    /* A card per level: all in one row on wide screens, two on tablets, one on phones. */
    .level-grid { display: grid; grid-template-columns: repeat(var(--levels, 3), minmax(0, 1fr)); gap: 18px; }
    @media (max-width: 1199.98px) { .level-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 575.98px) { .level-grid { grid-template-columns: minmax(0, 1fr); } }
    .lv-card { display: flex; flex-direction: column; background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; overflow: hidden;
      box-shadow: 0 4px 14px rgba(16, 61, 64, 0.08); margin: 0; }
    .lv-card > .lv-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px 14px; border: 0; }
    .lv-card > .lv-head h5 { margin: 0; min-width: 0; font-size: 12.5px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lv-body { display: flex; flex-direction: column; gap: 12px; padding: 16px; flex: 1 1 auto; }
    .lv-logo { align-self: center; }
    .lv-logo img { width: 96px; height: 96px; object-fit: contain; }
    .lv-facts { margin: 0; font-size: 13px; border-top: 1px solid #eef3f3; }
    .lv-facts > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; padding: 6px 0; border-bottom: 1px solid #eef3f3; }
    .lv-facts dt { color: #5f6f70; font-weight: 600; }
    .lv-facts dd { margin: 0; color: #232527; overflow-wrap: anywhere; }
    .lv-facts { min-height: 104px; }
    .lv-status { margin: auto 0 0; align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700;
      color: #a86a12; background: #fdf1dc; border-radius: 14px; padding: 3px 12px; }
    .lv-status.is-done { color: #1e7a3c; background: #e3f4e8; }
    .lv-steps-labels { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: #7a8a8b; }
    .lv-steps-labels span { flex: 1 1 0; text-align: center; }
    .lv-steps-labels span:first-child { text-align: left; }
    .lv-steps-labels span:last-child { text-align: right; }
    .lv-steps-labels span.on { color: #1e7a3c; font-weight: 700; }
    .lv-status img { width: 12px; }
    /* The progress bar across the card, filled up to the step the level is at. */
    .lv-steps ol { position: relative; display: flex; justify-content: space-between; list-style: none; margin: 0; padding: 0; }
    .lv-steps ol::before, .lv-steps ol::after { content: ''; position: absolute; left: 9px; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px; }
    .lv-steps ol::before { right: 9px; background: #e3e9ea; }
    .lv-steps ol::after { width: calc((100% - 18px) * var(--fill, 0)); background: #2e9e5b; }
    .lv-steps li { position: relative; z-index: 1; }
    .lv-steps .dot { display: block; width: 18px; height: 18px; border-radius: 9px; background: #fff; border: 2px solid #cfd8d9; }
    .lv-steps li.completed .dot { background: #2e9e5b; border-color: #2e9e5b; }
    .lv-steps li.current .dot { border: 4px solid #e8a33d; }
    .lv-actions { display: flex; gap: 8px; }
    .lv-actions .btn { flex: 1 1 0; white-space: nowrap; font-size: 12px; font-weight: 700; letter-spacing: .03em; padding: 6px 8px; }
    .lv-actions .lv-go { font-size: 16px; line-height: 1; }
    .lv-wide { width: 100%; font-size: 12px; font-weight: 700; }
    .lv-extra { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px dashed #dfe9ea; padding-top: 8px;
      font-size: 12.5px; font-weight: 700; }
    .lv-extra a:not(.btn), .lv-extra .clickable { color: #45a5ad; text-decoration: none; }
    /* Incentive cards in a grid of equal-height tiles. */
    /* Three incentive cards a row as the live dashboard (two on tablets, one on phones). */
    .panel-incen-box { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
    @media (max-width: 991.98px) { .panel-incen-box { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 575.98px) { .panel-incen-box { grid-template-columns: minmax(0, 1fr); } }
    .panel-incen-box .item { width: auto; margin: 0; }
    .panel-incen-box .panel-incen-block { height: 100%; }
    .panel-incen-box .panel-incen-block .panel-heading { padding: 16px 16px 0; align-items: center; }
    .panel-incen-box .panel-incen-block .panel-heading > img { width: 90px; height: 72px; object-fit: contain; }
    .panel-incen-box .panel-incen-block .panel-body { padding: 12px 16px 16px; }
    .panel-incen-box .panel-incen-block .panel-body h4 { font-size: 16px; margin-bottom: 6px; }
    /* The three parts of the disclaimer read as one list. */
    .disclaimer-points > zed-text:not(:last-child) ::ng-deep ol { margin-bottom: 0; padding-bottom: 0; }
    .apply-btn, .clickable { cursor: pointer; }
    .level-comment { white-space: pre-line; }
    .apply-logo { max-height: 180px; max-width: 100%; object-fit: contain; }
    .card-text-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .incentive-details { white-space: pre-line; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class DashboardPage {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  private readonly http = inject(HttpClient);
  /** The disclaimer and instructions must be shown before ACCEPT & PROCEED. */
  protected readonly textsLoaded = inject(ContentService).loaded;

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
  /** The levels the Admin has enabled (Administration → Certification Levels); the three until the server answers. */
  protected readonly publicLevels = signal<PublicLevel[]>([]);
  protected readonly levels = computed<Level[]>(() => {
    const enabled = this.publicLevels().map((l) => l.code).filter((c): c is Level => (KNOWN_LEVELS as readonly string[]).includes(c));
    return enabled.length ? enabled : ['Bronze', 'Silver', 'Gold'];
  });
  /** "Bronze, Silver, Gold or ZED-X" for the panel's line. */
  protected readonly levelsText = computed(() => {
    const names = this.levels().map((l) => this.levelName(l));
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  });


  protected readonly incentives = [
    { type: 'Common', title: 'Ministry of MSME', text: 'Incentives by MoMSME through its schemes, for ZED Certified MSMEs', image: '/Images/Dashboard/dash-msme.PNG', imageStyle: 'width: 140px; height: 90px; object-fit: contain;' },
    { type: 'States', title: 'States/UTs', text: 'Incentives by States/UTs for ZED Certified MSMEs', image: '/Images/Dashboard/stateUts.png', imageStyle: null },
    { type: 'Financial', title: 'Financial Institutions', text: 'Incentives by Financial Institutions for ZED Certified MSMEs', image: '/Images/Dashboard/financial-Institution.png', imageStyle: null },
    { type: 'Other', title: 'Other Incentives', text: 'Incentives by Central Ministries/Other Organisations for ZED Certified MSMEs', image: '/Images/Dashboard/incentive.png', imageStyle: null },
  ] as const;

  /** "My Incentives" as the Admin set it: the built-in cards' wording (or hidden) and the incentives put on the dashboard. */
  protected readonly builtInCards = signal<BuiltInCard[]>([]);
  protected readonly incentiveCards = signal<IncentiveCard[]>([]);

  /** The keys of the steps' texts (Admin → Texts). */
  protected readonly certificationSteps = [1, 2, 3, 4, 5].map((n) => `msme.dashboard.certificationSteps.${n}`);

  /** True once any level is certified; unlocks most incentives. */
  protected readonly anyCertified = computed(() =>
    this.num('BronzeStatus') === 6 || this.num('SilverStatus') === 16 || this.num('GoldStatus') === 16,
  );

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    void this.load();
    void this.loadIncentiveCards();
    firstValueFrom(this.http.get<PublicLevel[]>('/api/public/levels')).then((l) => this.publicLevels.set(l)).catch(() => undefined);
  }

  /** What pages show for a level ("ZED-X" for ZEDX). */
  protected levelName(level: string): string {
    return this.publicLevels().find((l) => l.code === level)?.name ?? levelName(level);
  }

  /** The level's logo: the Admin's, or the built-in picture. */
  protected levelLogo(level: string): string {
    return this.publicLevels().find((l) => l.code === level)?.logoUrl ?? levelLogo(level);
  }

  /** The information text the Admin wrote for a level without a built-in one (ZED-X). */
  protected levelComment(level: string): string {
    const l = this.publicLevels().find((p) => p.code === level);
    return l?.comment || l?.description || '';
  }

  /** The cards of "My Incentives"; on an error the built-in cards keep their wording before V4. */
  private async loadIncentiveCards(): Promise<void> {
    try {
      const r = await firstValueFrom(this.http.get<{ builtIn: BuiltInCard[]; incentives: IncentiveCard[] }>('/api/msme/dashboard/incentives'));
      this.builtInCards.set(r.builtIn ?? []);
      this.incentiveCards.set(r.incentives ?? []);
    } catch {
      // The rest of the dashboard does not depend on it.
    }
  }

  /** A built-in card as the Admin set it, or null when the Admin hid it. */
  protected card(key: string): BuiltInCard | null {
    const c = this.builtInCards().find((b) => b.card === key) ?? BUILT_IN_DEFAULTS[key];
    return c?.active ? c : null;
  }

  /** True when the unit is certified at a level the incentive applies to. */
  protected eligibleFor(c: IncentiveCard): boolean {
    return (c.applicableForBronze && this.num('BronzeStatus') === 6)
      || (c.applicableForSilver && this.num('SilverStatus') === 16)
      || (c.applicableForGold && this.num('GoldStatus') === 16);
  }

  protected levelsOf(c: IncentiveCard, separator = ', '): string {
    return [c.applicableForBronze && 'Bronze', c.applicableForSilver && 'Silver', c.applicableForGold && 'Gold'].filter(Boolean).join(separator);
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

  /** Micro, Small or Medium (the band's badge). */
  protected readonly entType = computed(() => String(this.msme()['EnterpriseType'] ?? ''));

  protected completed(level: Level): number {
    return COMPLETED[level];
  }

  protected months(n: number): string {
    return n % 12 === 0 ? `${n / 12} year${n === 12 ? '' : 's'}` : `${n} months`;
  }

  /** Valid for, Surveillance and Fee of a level's card, as Administration → Certification Levels sets them. */
  protected facts(level: Level): { label: string; value: string }[] {
    const l = this.publicLevels().find((p) => p.code === level);
    if (!l) return [];
    const rows = [{ label: 'Valid for', value: this.months(l.validityMonths) }];
    const s = l.surveillance;
    if (s) {
      rows.push({
        label: 'Surveillance',
        value: s.count && s.count > 1 ? `${s.count}, after ${s.firstDueMonths} months, then every ${s.intervalMonths}` : `after ${this.months(s.firstDueMonths)}`,
      });
    }
    if (l.fee) rows.push({ label: 'Fee', value: `₹ ${l.fee.toLocaleString('en-IN')}` });
    return rows;
  }

  /** How much of the card's progress bar is filled (0–1): up to the last step completed or in hand. */
  protected fill(level: Level): number {
    const rules = this.steps(level);
    const reached = rules.map((r) => this.stepClass(level, r)).reduce((last, c, i) => (c ? i : last), -1);
    return rules.length > 1 && reached > 0 ? reached / (rules.length - 1) : 0;
  }

  protected status(level: Level): number {
    return this.num(`${level}Status`);
  }

  /** ZED-X: basic information and documents are entered on the web (the MSME app has no ZED-X). */
  protected webEntry(level: Level): boolean {
    return isWebEntryLevel(level);
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
    const b = this.status('Bronze'), s = this.status('Silver'), g = this.status('Gold'), x = this.status('ZEDX');
    // Two certifications never run at once: ZED-X and Bronze/Silver/Gold exclude each other while one of them is in
    // progress. ZED-X is the highest level: once certified it closes the three, as Gold does Bronze and Silver. The server
    // checks the same (Certifications.BlockedBy).
    const inProgress = (l: Level, v: number) => v > 0 && (l === 'Bronze' ? v < 6 || v === 7 : v < 16 || v === 17);
    if (level === 'ZEDX') return x < 1 && (inProgress('Bronze', b) || inProgress('Silver', s) || inProgress('Gold', g));
    if (this.status(level) < 1 && x > 0) return true;
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
    // ZED-X: the API gives ZEDXDashboardSurStatus / IsSurZEDXPaymentDone (Admin's schedule, migration 0032).
    return !this.is(this.msme(), `${level}DashboardSurStatus`, 0);
  }

  protected surveillancePaid(level: Level): boolean {
    return !!this.msme()[`IsSur${level}PaymentDone`];
  }

  protected reCertificationVisible(level: Level): boolean {
    // Every level, Bronze included (the old page showed Bronze re-certification to one pilot unit only).
    const b = this.basic();
    return this.is(b, 'ReCertification', 1) && b['ReCertificationLevel'] === level;
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
    return topic === 'MyIncentives' ? 'My Incentives' : topic === 'My' ? 'My Certification' : `${this.levelName(topic)} Certification`;
  }
}

function readUbpReturnUrl(): string | null {
  try {
    return sessionStorage.getItem('zed.ubpReturnUrl');
  } catch {
    return null;
  }
}
