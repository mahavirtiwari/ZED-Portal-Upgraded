import { formatDate } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentService, ContentTextComponent } from '../../content/content-text';
import { PaymentBilling } from '../payment/payment-step';
import { ApplyFlow, ApplyLevelVm, ApplyStep } from './apply-flow';
import { isLegacyLevel, levelLogo, levelName } from '../shared/levels';
import { PageHead } from '../shared/page-head';
import { DashExtras } from './dash-extras';
import { DashIcon } from './dash-icon';
import { IncentiveTile, IncentiveTileVm } from './incentive-tile';
import { LevelCard, LevelCardVm, LevelFact } from './level-card';

type Row = Record<string, string | number | boolean | null>;

interface DashboardData {
  msme: Row;
  basicInfo: Row;
  certStatus: Row;
}

/**
 * A level's code: Bronze, Silver, Gold, ZEDX (ZED-X) or a level the Admin added (2026-11-08, Administration → Certification
 * Levels), shown once the Admin enables it. The levels other than Bronze, Silver and Gold work as ZED-X does.
 */
type Level = string;

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

/** A card of "Your next steps": a link, "View incentives" (scroll) or APPLY of the recommended level. */
interface NextStepVm {
  key: string;
  icon: string;
  /** hi: the green card (incentives); nc: non-conformances to answer. */
  tone: 'hi' | 'nc' | 'plain';
  /** The level's badge in place of the icon (Apply for …). */
  logo?: string;
  /** The step of the level in progress (class next-step). */
  progress?: boolean;
  title: string;
  text: string;
  action: string;
  link?: unknown[];
  scroll?: boolean;
  apply?: Level;
}

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
  /** 2026-11-16 (migration 0091): ZED-X (Export) certified units too. The server leaves out the incentives of the other activity. */
  applicableForZEDX?: boolean;
  applicableActivity?: string | null;
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

/** Desktop and site assessment: the statuses of the site levels (Silver, Gold, ZED-X and the Admin's site levels). */
const SITE_STEPS: StepRule[] = [
  { doneAbove: 1, currentFrom: 0, currentTo: 1, label: 'Details' },
  { doneAbove: 5, currentFrom: 1, currentTo: 5, label: 'Desktop' },
  { doneAbove: 14, currentFrom: 6, currentTo: 14, label: 'Site visit' },
  { doneAbove: 15, currentFrom: 14, currentTo: 15, label: 'Certified' },
];

/** A level the Admin added with desktop assessment only: the site levels' statuses without the site visit. */
const DESKTOP_V4_STEPS: StepRule[] = [
  { doneAbove: 1, currentFrom: 0, currentTo: 1, label: 'Details' },
  { doneAbove: 14, currentFrom: 1, currentTo: 14, label: 'Desktop' },
  { doneAbove: 15, currentFrom: 14, currentTo: 15, label: 'Certified' },
];

const STEPS: Record<string, StepRule[]> = {
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
};

/** Status code meaning "certified" per level (MsmeCertifications.CertificationStatus): 6 for Bronze, 16 for the others (as ZED-X). */
const completedStatus = (level: Level): number => (level === 'Bronze' ? 6 : 16);

/**
 * MSME dashboard. Port of Views/Msme/Dashboard.cshtml: unit summary, certification cards,
 * incentives, certification steps, the information pop-ups and the first two steps of applying
 * (disclaimer, instructions, payment). V4 layout: the unit in one band at the top (no side bar), and a larger card per
 * level, all in one row on wide screens, with its validity, surveillance and fee (Administration → Certification Levels),
 * its status above a progress bar, and its two buttons side by side.
 * 2026-11-17 (the user's Home design): the shared page head ("Welcome, <unit>", last refreshed, Refresh), the unit card with
 * its current level, "Your next steps" (up to three, from the unit's state), the level cards (child LevelCard, the
 * recommended next level outlined), the incentives with a status chip each (child IncentiveTile), and the foot (DashExtras).
 */
@Component({
  selector: 'zed-msme-dashboard',
  imports: [RouterLink, ApplyFlow, ContentTextComponent, PageHead, LevelCard, IncentiveTile, DashExtras, DashIcon],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardPage {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
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
  /** What this unit would pay for each level (after subsidy, with GST), by level code. */
  protected readonly levelFees = signal<Record<string, number | null>>({});
  /** Every enabled level, those the Admin added too (2026-11-08); a code with a level code's shape only. */
  protected readonly levels = computed<Level[]>(() => {
    const enabled = this.publicLevels().map((l) => l.code).filter((c) => /^[A-Za-z][A-Za-z0-9]{1,19}$/.test(c ?? ''));
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

  /** True once any level is certified; unlocks most incentives. */
  protected readonly anyCertified = computed(() =>
    this.num('BronzeStatus') === 6 || this.num('SilverStatus') === 16 || this.num('GoldStatus') === 16
      || this.status('ZEDX') === completedStatus('ZEDX'),
  );

  /** 2026-11-17: /msme/dashboard?apply=Silver opens the apply flow of that level (when it may be applied for). */
  private readonly route = inject(ActivatedRoute);
  private pendingApply: string | null = this.route.snapshot.queryParamMap.get('apply');
  /** The Admin's levels have answered (or failed): a level the Admin added is known only then. */
  private readonly levelsLoaded = signal(false);

  constructor() {
    effect(() => {
      const d = this.data();
      const loaded = this.levelsLoaded();
      if (!d || !this.pendingApply) return;
      untracked(() => {
        const level = this.levels().find((l) => l.toLowerCase() === this.pendingApply!.toLowerCase());
        if (level && this.canApply(level)) {
          this.pendingApply = null;
          this.apply(level);
        } else if (loaded) {
          this.pendingApply = null;
        }
      });
    });
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    void this.load();
    void this.loadIncentiveCards();
    firstValueFrom(this.http.get<PublicLevel[]>('/api/public/levels')).then((l) => this.publicLevels.set(l)).catch(() => undefined)
      .finally(() => this.levelsLoaded.set(true));
    // The unit's own fee of each level, from Master → Payments (2026-11-08).
    firstValueFrom(this.http.get<Record<string, number | null>>('/api/msme/dashboard/level-fees')).then((f) => this.levelFees.set(f ?? {})).catch(() => undefined);
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
      || (c.applicableForGold && this.num('GoldStatus') === 16)
      || (!!c.applicableForZEDX && this.status('ZEDX') === completedStatus('ZEDX'));
  }

  protected levelsOf(c: IncentiveCard, separator = ', '): string {
    return [c.applicableForBronze && 'Bronze', c.applicableForSilver && 'Silver', c.applicableForGold && 'Gold', c.applicableForZEDX && 'ZED-X']
      .filter(Boolean).join(separator);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await firstValueFrom(this.http.get<DashboardData>('/api/msme/dashboard')));
      this.refreshedAt.set(new Date());
      // The header's Certifications / Incentives links (#certifications, #incentives): the sections exist once the data is in.
      const fragment = this.route.snapshot.fragment;
      if (fragment) setTimeout(() => document.getElementById(fragment)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
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

  /** 2026-11-15: the pop-up's "Availed" chip: the joining reward used, financial assistance or TU availed. */
  protected availed(kind: string): boolean {
    if (kind === 'joining') return this.is(this.msme(), 'IsCouponUsed', 1);
    if (kind === 'fa') return this.is(this.cert(), 'FinancialAssistanceStatus', 0);
    if (kind === 'tu') return this.is(this.cert(), 'TechnologyUpgradationStatus', 0);
    return false;
  }

  /** An amount as ₹ 10,000 (Indian grouping); a text that is not a number stays as it is. */
  protected rupees(v: unknown): string {
    const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
    return v === null || v === undefined || v === '' || !Number.isFinite(n) ? String(v ?? '') : '₹ ' + n.toLocaleString('en-IN');
  }

  /** Loose equality like the AngularJS expressions (null/undefined never equal a number). */
  protected is(row: Row, field: string, value: number): boolean {
    const v = row[field];
    return v !== null && v !== undefined && Number(v) === value;
  }

  /** Micro, Small or Medium (the band's badge). */
  protected readonly entType = computed(() => String(this.msme()['EnterpriseType'] ?? ''));

  protected months(n: number): string {
    return n % 12 === 0 ? `${n / 12} year${n === 12 ? '' : 's'}` : `${n} months`;
  }

  /** Valid for, Surveillance and Fee of a level's card, as Administration → Certification Levels sets them. */
  protected facts(level: Level): LevelFact[] {
    const l = this.publicLevels().find((p) => p.code === level);
    if (!l) return [];
    const rows: LevelFact[] = [{ label: 'Valid for', value: this.months(l.validityMonths) }];
    const visits = this.surveillanceMonths(level);
    if (visits.length) rows.push({ label: 'Surveillance', value: `${visits.length} visit${visits.length > 1 ? 's' : ''} (month ${visits.join(', ')})` });
    const fee = this.levelFees()[level];
    if (typeof fee === 'number')
      rows.push(fee > 0 ? { label: 'Your fee', value: this.inr(fee), note: 'incl. GST, after subsidy' } : { label: 'Your fee', value: 'Nil', note: 'fully subsidised' });
    return rows;
  }

  /** The months after certification the level's surveillance visits fall due (Administration → Certification Levels). */
  private surveillanceMonths(level: Level): number[] {
    const s = this.publicLevels().find((p) => p.code === level)?.surveillance;
    if (!s) return [];
    const n = s.count && s.count > 1 && s.intervalMonths ? s.count : 1;
    return Array.from({ length: n }, (_, i) => s.firstDueMonths + i * (s.intervalMonths ?? 0));
  }

  private inr(n: number): string {
    return `₹ ${Math.round(n).toLocaleString('en-IN')}`;
  }

  protected certified(level: Level): boolean {
    return this.status(level) === completedStatus(level);
  }

  /** "Last refreshed on 17 Nov 2026, 06:06 AM" under the title. */
  protected readonly refreshedText = computed(() => `Last refreshed on ${formatDate(this.refreshedAt(), 'd MMM y, hh:mm a', 'en-US')}`);

  /** The highest level the unit is certified at (the last certified one in the Admin's order). */
  protected readonly currentLevel = computed<Level | null>(() => this.levels().filter((l) => this.certified(l)).pop() ?? null);

  /** A surveillance round open for the level (an explicit, non-zero {Code}DashboardSurStatus). */
  private surveillanceOpen(level: Level): boolean {
    const v = this.msme()[`${level}DashboardSurStatus`];
    return v !== null && v !== undefined && Number(v) !== 0;
  }

  /** The unit card's facts on the right: the current level, its validity and surveillance (none before a certification). */
  protected readonly unitFacts = computed(() => {
    const level = this.currentLevel();
    if (!level) return null;
    const pl = this.publicLevels().find((p) => p.code === level);
    const visits = this.surveillanceMonths(level);
    const open = this.surveillanceOpen(level);
    const paid = this.surveillancePaid(level);
    return {
      level, name: this.levelName(level), logo: this.levelLogo(level),
      validity: pl ? this.months(pl.validityMonths) : null,
      surveillance: open
        ? { label: 'Next surveillance', value: 'Due now', note: paid ? 'Under way' : 'Apply and pay',
            link: paid ? ['/msme/certification', level + 'Surveillance'] : ['/msme/surveillance-payment', level] }
        : visits.length
          ? { label: 'Surveillance', value: `Month ${visits.join(', ')}`, note: `${visits.length} visit${visits.length > 1 ? 's' : ''} after certification`, link: null }
          : null,
    };
  });

  /** The level to apply for next: the first one above the highest certified that is open and not applied for. */
  protected readonly recommended = computed<Level | null>(() => {
    const all = this.levels();
    const from = all.reduce((at, l, i) => (this.certified(l) ? i + 1 : at), 0);
    return all.slice(from).find((l) => !this.paid(l) && !this.levelDisabled(l) && this.status(l) === 0) ?? null;
  });

  /** The status chip of a level's card. */
  private chip(level: Level): LevelCardVm['chip'] {
    if (this.levelDisabled(level)) return { label: 'Locked', tone: 'locked' };
    const s = this.status(level);
    if (s === completedStatus(level)) return { label: 'Certified', tone: 'done' };
    if (s === 0) return this.recommended() === level ? { label: 'Ready to apply', tone: 'ready' } : { label: 'Not started', tone: 'new' };
    return s > 0 && s < completedStatus(level) ? { label: 'In progress', tone: 'prog' } : null;
  }

  /** One card of "My Certifications" per enabled level. */
  protected readonly levelCards = computed<LevelCardVm[]>(() =>
    this.levels().map((level) => ({
      code: level, name: this.levelName(level), logo: this.levelLogo(level), added: this.addedLevel(level), disabled: this.levelDisabled(level),
      recommended: this.recommended() === level, facts: this.facts(level), chip: this.chip(level),
      steps: this.steps(level).map((r) => ({ label: r.label, cls: this.stepClass(level, r) })), fill: this.fill(level),
      paid: this.paid(level), certified: this.certified(level),
      surveillance: this.surveillanceVisible(level) ? { paid: this.surveillancePaid(level) } : null,
      reCertification: this.reCertificationVisible(level),
    })),
  );

  /** "My Incentives": the built-in cards as the Admin set them, the Admin's dashboard incentives, then the stakeholders' lists. */
  protected readonly incentiveTiles = computed<(IncentiveTileVm & { modal?: Modal })[]>(() => {
    const notCertified = 'Unlocks once your unit is certified';
    const notEligible = 'Not yet available for your unit';
    const tiles: (IncentiveTileVm & { modal?: Modal })[] = [];
    const base = (key: string, icon: string, b: BuiltInCard) => ({ key, icon, title: b.title, highlight: b.highlight, details: b.details, note: null });
    const benefits = this.is(this.basic(), 'IsEligibleForBenefits', 1);

    const joining = this.card('JOINING_REWARD');
    if (joining) {
      const used = this.is(this.msme(), 'IsCouponUsed', 1);
      tiles.push({ ...base('joining', 'award', joining), state: used ? 'availed' : 'open', action: { label: used ? 'View details' : 'Avail' }, modal: { kind: 'joining' } });
    }
    const fa = this.card('FINANCIAL_ASSISTANCE');
    if (fa) {
      const eligible = this.is(this.basic(), 'IsEligibleForFinancial', 1);
      const availed = eligible && this.is(this.cert(), 'FinancialAssistanceStatus', 0);
      tiles.push(!eligible ? { ...base('fa', 'rupee', fa), state: 'locked', action: null, note: notEligible }
        : availed ? { ...base('fa', 'rupee', fa), state: 'availed', action: { label: 'View details' }, modal: { kind: 'fa' } }
          : { ...base('fa', 'rupee', fa), state: 'open', action: { label: 'Avail', link: '/msme/financial-assistance' } });
    }
    const hh = this.card('HANDHOLDING');
    if (hh) {
      const open = this.anyCertified() && benefits;
      const running = this.num('ConsultancyStatus') > 0;
      tiles.push(!open ? { ...base('hh', 'users', hh), state: 'locked', action: null, note: this.anyCertified() ? notEligible : notCertified }
        : { ...base('hh', 'users', hh), state: running ? 'progress' : 'open', action: { label: running ? 'View milestones' : 'Avail', link: '/msme/handholding' } });
    }
    const tu = this.card('TECHNOLOGY_UPGRADATION');
    if (tu) {
      const availed = this.is(this.cert(), 'TechnologyUpgradationStatus', 0);
      const open = (availed || this.is(this.cert(), 'TechnologyUpgradationStatus', 1)) && benefits;
      tiles.push(!open ? { ...base('tu', 'zap', tu), state: 'locked', action: null, note: notEligible }
        : availed ? { ...base('tu', 'zap', tu), state: 'availed', action: { label: 'View details' }, modal: { kind: 'tu' } }
          : { ...base('tu', 'zap', tu), state: 'open', action: { label: 'Avail', link: '/msme/technology-upgradation' } });
    }
    for (const c of this.incentiveCards()) {
      const ok = this.eligibleFor(c);
      const levels = this.levelsOf(c, ' or ');
      tiles.push({ key: `inc-${c.id}`, icon: 'star', title: c.title, highlight: c.highlight, details: c.details, clamp: true,
        state: ok ? 'open' : 'locked', action: { label: ok ? 'Avail' : 'View details' }, note: ok ? null : levels ? `For ${levels} certified units` : notEligible,
        modal: { kind: 'incentive', card: c } });
    }
    const icons: Record<string, string> = { Common: 'building', States: 'pin', Financial: 'bank', Other: 'trend' };
    for (const inc of this.incentives) {
      const ok = this.anyCertified();
      tiles.push({ key: inc.type, icon: icons[inc.type], title: inc.title, highlight: null, details: inc.text, state: ok ? 'open' : 'locked',
        action: ok ? { label: 'Browse incentives', link: '/incentives', query: this.incentiveQuery(inc.type) } : null, note: ok ? null : notCertified });
    }
    return tiles;
  });

  /** "Your next steps": up to three cards from the unit's state, most urgent first. */
  protected readonly nextSteps = computed<NextStepVm[]>(() => {
    const out: NextStepVm[] = [];
    const n = this.nextStep();
    if (n) {
      const name = this.levelName(n.level);
      out.push({ key: 'progress', icon: n.kind === 'nc' ? 'alert' : n.kind === 'entry' ? 'file' : 'clock', tone: n.kind === 'nc' ? 'nc' : 'plain', progress: true,
        title: n.kind === 'nc' ? `Answer the ${name} non-conformances` : n.kind === 'entry' ? `Continue ${name} certification` : `${name} certification under assessment`,
        text: n.text, action: 'View details', link: n.link });
    }
    for (const level of this.levels().filter((l) => this.certified(l) && this.surveillanceOpen(l))) {
      const paid = this.surveillancePaid(level);
      out.push({ key: `sur-${level}`, icon: 'shield', tone: 'plain', title: `${this.levelName(level)} surveillance due`,
        text: paid ? 'Your surveillance is under way. See its details and next step.' : 'Apply and pay for the surveillance of your certificate.',
        action: paid ? 'View surveillance' : 'Apply for surveillance',
        link: paid ? ['/msme/certification', level + 'Surveillance'] : ['/msme/surveillance-payment', level] });
    }
    const current = this.currentLevel();
    const open = this.incentiveTiles().filter((t) => t.state === 'open').map((t) => t.title).filter((t): t is string => !!t);
    if (current && open.length) {
      out.push({ key: 'incentives', icon: 'gift', tone: 'hi', title: `Avail your ${this.levelName(current)} incentives`,
        text: `${open.slice(0, 3).join(', ')}${open.length > 3 ? ' and more' : ''} ${open.length > 1 ? 'are' : 'is'} open to you.`, action: 'View incentives', scroll: true });
    }
    const rec = this.recommended();
    if (rec && !n) {
      const fee = this.levelFees()[rec];
      const feeText = typeof fee === 'number' ? (fee > 0 ? `Your fee is ${this.inr(fee)} incl. GST, after subsidy. ` : 'Fully subsidised for your unit. ') : '';
      const site = this.steps(rec).some((r) => r.label === 'Site visit');
      out.push({ key: 'apply', icon: 'award', tone: 'plain', logo: this.levelLogo(rec), title: `Apply for ${this.levelName(rec)} certification`,
        text: feeText + (site ? 'Desktop check plus a site visit.' : 'Desktop assessment of your documents.'), action: `Apply for ${this.levelName(rec)}`, apply: rec });
    }
    if (this.num('ConsultancyStatus') > 0 && this.card('HANDHOLDING')) {
      out.push({ key: 'handholding', icon: 'users', tone: 'plain', title: 'Continue handholding', text: 'Track the milestones of your handholding support.',
        action: 'View milestones', link: ['/msme/handholding'] });
    }
    return out.slice(0, 3);
  });

  /** "View incentives" of the next steps: scrolls to My Incentives. */
  protected scrollToIncentives(): void {
    document.getElementById('incentives')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** An incentive card's button: its pop-up. */
  protected openTile(t: { modal?: Modal }): void {
    if (t.modal) this.open(t.modal);
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

  /** 2026-11-14 (approved design): the next step of the first paid level that is not completed. */
  protected readonly nextStep = computed<{ level: Level; kind: 'entry' | 'nc' | 'wait'; text: string; action: string; link: string[] } | null>(() => {
    for (const level of this.levels()) {
      if (!this.paid(level)) continue;
      const s = this.status(level);
      if (s === completedStatus(level) || s === 7 || s === 17) continue;
      // 2026-11-14: basic information, documents and NC answers are entered in the ZED MSME app (no web entry).
      if (s <= 1)
        return { level, kind: 'entry', text: 'Complete Basic Information & Documents in the ZED MSME app and final submit.', action: 'DETAILS',
          link: ['/msme/certification', level] };
      if (s === 4 || s === 14)
        return { level, kind: 'nc', text: 'Answer the non-conformances raised in the assessment in the ZED MSME app.', action: 'DETAILS',
          link: ['/msme/certification', level] };
      return { level, kind: 'wait', text: 'Your application is under assessment. We will notify you of the next step.', action: 'DETAILS',
        link: ['/msme/certification', level] };
    }
    return null;
  });

  /** A level the Admin added (not Bronze, Silver, Gold or ZED-X): no colours of its own on the page. */
  protected addedLevel(level: Level): boolean {
    return !isLegacyLevel(level) && level !== 'ZEDX';
  }

  /** ZED-X and the levels the Admin added: basic information and documents are entered on the web (the MSME app has no ZED-X). */

  protected paid(level: Level): boolean {
    return this.is(this.msme(), `Is${level}PaymentDone`, 1);
  }

  protected stepClass(level: Level, rule: StepRule): string {
    const s = this.status(level);
    if (s > rule.doneAbove) return 'completed';
    if (rule.currentFrom === 0 ? s === 1 : s > rule.currentFrom && s <= rule.currentTo) return 'current';
    return '';
  }

  /** Bronze, Silver and Gold their own; ZED-X and the Admin's levels by their assessment (desktop, or desktop and site). */
  protected steps(level: Level): StepRule[] {
    if (isLegacyLevel(level)) return STEPS[level] ?? SITE_STEPS;
    return this.publicLevels().find((l) => l.code === level)?.assessmentMode === 'Desktop' ? DESKTOP_V4_STEPS : SITE_STEPS;
  }

  /**
   * Cards are greyed out while another level is in progress or already certified
   * (same conditions as the old page).
   */
  protected levelDisabled(level: Level): boolean {
    const b = this.status('Bronze'), s = this.status('Silver'), g = this.status('Gold');
    // Two certifications never run at once: ZED-X (and every level the Admin added, 2026-11-08) and Bronze/Silver/Gold
    // exclude each other while one of them is in progress. ZED-X is the highest level: once certified it closes the three,
    // as Gold does Bronze and Silver; so does a level the Admin added. The server checks the same (Certifications.BlockedBy).
    const inProgress = (l: Level, v: number) => v > 0 && (l === 'Bronze' ? v < 6 || v === 7 : v < 16 || v === 17);
    const v4 = this.levels().filter((l) => !isLegacyLevel(l));
    if (!isLegacyLevel(level)) {
      return this.status(level) < 1
        && [...['Bronze', 'Silver', 'Gold'], ...v4.filter((l) => l !== level)].some((l) => inProgress(l, this.status(l)));
    }
    if (this.status(level) < 1 && v4.some((l) => this.status(l) > 0)) return true;
    switch (level) {
      case 'Bronze':
        return (b < 1 && s > 0 && (s <= 16 || s === 17)) || (b < 1 && g > 0 && g <= 16) || g === 16 || s === 16 || g === 17;
      case 'Silver':
        return (s < 1 && b > 0 && (b < 6 || b === 7)) || (s < 1 && g > 0 && g <= 16) || g === 16 || g === 17;
      case 'Gold':
        return (g < 1 && s > 0 && (s < 16 || s === 17)) || (g < 1 && b > 0 && (b < 6 || b === 7));
      default:
        return false;
    }
  }

  protected surveillanceVisible(level: Level): boolean {
    // ZED-X: the API gives ZEDXDashboardSurStatus / IsSurZEDXPaymentDone (Admin's schedule, migration 0032); the levels the
    // Admin added the same ({CODE}DashboardSurStatus), and none until the API gives it.
    const v = this.msme()[`${level}DashboardSurStatus`];
    if (!isLegacyLevel(level) && level !== 'ZEDX') return v !== null && v !== undefined && Number(v) !== 0;
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

  /** A level may be applied for: enabled, not closed by another level, and not paid (or open for re-certification). */
  protected canApply(level: Level): boolean {
    return this.levels().includes(level) && !this.levelDisabled(level) && (!this.paid(level) || this.reCertificationVisible(level));
  }

  /** The open step of the apply flow. */
  protected readonly applyStep = computed<ApplyStep>(() => (this.step() === 'home' ? 'disclaimer' : (this.step() as ApplyStep)));

  /** The disclaimer's right rail: the level, the unit, its fee, validity, surveillance and assessment. */
  protected readonly applyVm = computed<ApplyLevelVm>(() => {
    const level = this.applyLevel();
    const used = this.is(this.msme(), 'IsCouponUsed', 1);
    const fee = this.levelFees()[level];
    const fees: LevelFact[] = [
      ...(typeof fee === 'number' ? [fee > 0 ? { label: 'Your fee', value: this.inr(fee), note: 'incl. GST, after subsidy' } : { label: 'Your fee', value: 'Nil', note: 'fully subsidised' }] : []),
      ...this.facts(level).filter((f) => f.label !== 'Your fee'),
    ];
    const order = ['Your fee', 'Valid for', 'Surveillance'];
    return {
      code: level, name: this.levelName(level), logo: this.levelLogo(level),
      unitName: String(this.msme()['EnterpriseName'] ?? ''), zedId: String(this.msme()['ZedId'] ?? ''),
      facts: order.map((l) => fees.find((f) => f.label === l)).filter((f): f is LevelFact => !!f)
        .map((f) => (f.label === 'Valid for' ? { ...f, label: 'Validity' } : f)),
      assessment: this.steps(level).some((r) => r.label === 'Site visit') ? 'Desktop check and site visit' : 'Desktop assessment',
      reCertification: this.num('ReCertification', this.basic()) > 0,
      rewardUsed: used ? { level: String(this.msme()['LatestCertification'] ?? ''), date: String(this.msme()['DateOfAvail'] ?? '') } : null,
    };
  });

  /** The billing details of the fee step, from the unit's registration as the dashboard has it. */
  protected readonly billing = computed<PaymentBilling>(() => {
    const m = this.msme();
    const t = (k: string) => String(m[k] ?? '').trim();
    const address = [t('PUnitName'), t('PAddress'), t('PDistrictName'), [t('PStateName'), t('PPin')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return { name: t('EnterpriseName') || null, address: address || null, zedId: t('ZedId') || null,
      unit: [t('EnterpriseName'), t('ZedId')].filter(Boolean).join(' · ') || null };
  });

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
