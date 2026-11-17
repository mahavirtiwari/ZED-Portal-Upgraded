import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientConfigService, PortalLinksService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CertificationTimeline } from './certification-timeline';
import { monthYear, nextSurveillance, parseShortDate, shortDate, validTill, validityOf } from './certification-dates';
import { ncBlock, progressOptions, progressSteps, splitDate, statusText, timelineItems } from './certification-progress';
import {
  CertificationApi,
  CertificationData,
  Row,
  canonicalCertification,
  certificationKind,
  certificationLevel,
  incentiveUrl,
  milestoneNumber,
} from './certification.api';
import { PageHead, Crumb } from '../shared/page-head';
import { StepTracker } from '../shared/step-tracker';
import { PublicLevels, allLevels, levelLogo, levelMode, levelName } from '../shared/levels';
import { isWebEntryLevel } from '../entry/entry.api';
import { reportRoute } from '../../report/report.api';

/** One box in the "Actions" column. */
interface Action {
  icon: string;
  label: string;
  enabled: boolean;
  danger?: boolean;
  /** A page of this portal, opened in the same tab. */
  route?: string;
  /** Opens in a new tab. Absent (and no route): the target page is not migrated yet ("Available soon"). */
  href?: string;
  download?: boolean;
  /** A page of this portal opened in a new tab (the report page, 2026-11-15). */
  newTab?: boolean;
}

/** Folder of a stored surveillance certificate: {SurveCertPath}/DA|SA/{ZedId}/{Level}.pdf. */
const CERT_PATH = /^Surveillance\/Certifica(tions|tes)$/;

/** Certificates and reports of the signed-in MSME (authorised downloads). */
const DOCUMENTS_API = '/api/msme/certification-documents';

/** The rail's "Your next step" card. */
interface NextStep {
  title: string;
  text: string;
  label?: string;
  route?: string;
  href?: string;
}

/** The rail's "Go further" card: the next level, the unit's fee for it (null: not known) and Apply. */
interface GoFurther {
  level: string;
  fee: number | null;
}

/**
 * Status and actions of one certification (Bronze, Silver, Gold, their surveillance, or a
 * handholding milestone). Port of Views/Msme/CertificationDetails.cshtml. Assessment pages,
 * certificates and reports open in this portal.
 * 2026-11-17 (the user's applicant design, zed-msme-01): page head; a header card with the unit, the status and both
 * downloads; the step tracker; the application timeline (NCs in one block); a right rail with the next step, the next level
 * and the page's actions. The app banner only while a step is pending in the app.
 */
@Component({
  selector: 'zed-msme-certification-details',
  imports: [NgTemplateOutlet, RouterLink, PageHead, StepTracker, CertificationTimeline],
  templateUrl: './certification-details.html',
  styleUrls: ['./certification-details.scss', './certification-rail.scss'],
})
export class CertificationDetailsPage {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
  /** Route parameter :certification. */
  readonly certification = input.required<string>();

  private readonly api = inject(CertificationApi);
  private readonly config = inject(ClientConfigService);
  private readonly http = inject(HttpClient);
  private readonly levels = inject(PublicLevels);
  private request = 0;

  protected readonly data = signal<CertificationData | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly legacyUrl = signal('');

  protected readonly type = computed(() => canonicalCertification(this.certification()));
  protected readonly kind = computed(() => certificationKind(this.type() ?? 'Bronze'));
  protected readonly level = computed(() => certificationLevel(this.type() ?? 'Bronze'));
  protected readonly milestone = computed(() => milestoneNumber(this.type() ?? ''));
  /** Page title (V4 page head). */
  protected readonly heading = computed(() => {
    switch (this.kind()) {
      case 'surveillance':
        return `${levelName(this.level())} Surveillance`;
      case 'milestone':
        return `Handholding Support: Milestone ${this.milestone()}`;
      default:
        return `${levelName(this.level())} Certification`;
    }
  });

  /** Breadcrumb: Home › Certifications (or Handholding) › the level. */
  protected readonly crumbs = computed<Crumb[]>(() => {
    const name = levelName(this.level());
    if (this.kind() === 'milestone') {
      return [{ label: 'Home', link: '/msme/dashboard' }, { label: 'Handholding', link: '/msme/handholding' }, { label: `${name} milestone ${this.milestone()}` }];
    }
    return [
      { label: 'Home', link: '/msme/dashboard' },
      { label: 'Certifications', link: '/msme/dashboard' },
      { label: this.kind() === 'surveillance' ? `${name} surveillance` : name },
    ];
  });
  protected readonly backLink = computed(() => (this.kind() === 'milestone' ? '/msme/handholding' : '/msme/dashboard'));

  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly basic = computed<Row>(() => this.data()?.basicInfo ?? {});
  protected readonly cert = computed<Row>(() => this.data()?.certStatus ?? {});
  protected readonly status = computed<Row>(() => this.data()?.status ?? {});

  /**
   * The mobile app banner was shown for every type except Bronze surveillance and the milestones; 2026-11-17 (design note)
   * only while a step is pending in the app (basic information and documents not submitted, not certified).
   */
  protected readonly showAppBanner = computed(() =>
    (['Bronze', 'Silver', 'Gold', 'SilverSurveillance', 'GoldSurveillance'].includes(this.type() ?? '') || this.webEntry())
      && !this.has('GetCertified') && !this.infoDone(),
  );
  /**
   * ZED-X and the levels the Admin added: what the app uploaded is shown read-only on the entry page (2026-11-14: no level
   * has web entry; everything is entered in the ZED MSME app).
   */
  protected readonly webEntry = computed(() => isWebEntryLevel(this.type()));


  protected readonly incentiveUrl = computed(() => incentiveUrl(this.data()));

  // ----- 2026-11-17 design: header card, tracker, timeline, rail -----

  protected readonly logo = computed(() => levelLogo(this.level()));
  protected readonly levelTitle = computed(() => levelName(this.level()));
  /** "Micro", "Small" or "Medium" (UAM registrations: their own type column). */
  protected readonly size = computed(() => String((this.msme()['RegistrationType'] === 'UAM' ? this.msme()['EnterpriseTypee'] : this.msme()['EnterpriseType']) ?? ''));
  protected readonly plant = computed(() => {
    const m = this.msme();
    const place = [m['PDistrictName'], m['PStateName']].map((x) => String(x ?? '').trim()).filter((x) => x).join(', ');
    return [String(m['PUnitName'] ?? '').trim(), place].filter((x) => x).join(', ');
  });
  /** The chip next to the unit's name. */
  protected readonly statusChip = computed(() => {
    if (this.kind() === 'milestone') return this.has('ApplicantAcceptedOn') ? 'COMPLETED' : this.anyStatus() ? 'IN PROGRESS' : '';
    if (this.has('GetCertified')) return this.kind() === 'surveillance' ? 'SURVEILLANCE CERTIFIED' : `${this.levelTitle().toUpperCase()} CERTIFIED`;
    return this.anyStatus() ? 'IN PROGRESS' : '';
  });
  /**
   * The dates the descriptions carry; 2026-11-18 (design): once a level is certified, Certified on, Valid till (the
   * certification date plus the level's validity, less a day) and Next surveillance (the first visit month not yet past).
   * Before that: Applied on.
   */
  protected readonly facts = computed(() => {
    const date = (field: string) => splitDate(statusText(this.status(), field)).date;
    if ((this.kind() === 'bronze' || this.kind() === 'silverGold') && this.has('GetCertified')) {
      const on = date('GetCertified');
      const list = [{ label: 'Certified on', value: on }];
      const certified = parseShortDate(on);
      const v = this.validity();
      if (certified && v) {
        if (v.validityMonths > 0) list.push({ label: 'Valid till', value: shortDate(validTill(certified, v.validityMonths)) });
        const next = nextSurveillance(certified, v.surveillanceMonths);
        if (next) list.push({ label: 'Next surveillance', value: monthYear(next) });
      }
      return list.filter((f) => f.value);
    }
    const list = [{ label: 'Applied on', value: date('ApplicationReceived') }];
    list.push(this.kind() === 'milestone' ? { label: 'Completed on', value: date('CompletedOn') } : { label: 'Certified on', value: date('GetCertified') });
    return list.filter((f) => f.value);
  });
  /** The level's validity and surveillance months: from the certification API, else the Admin's enabled level (api/public/levels). */
  private readonly validity = computed(() => {
    const own = this.data()?.validity;
    if (own) return own;
    const code = this.level().toLowerCase();
    return validityOf(this.levels.levels()?.find((l) => l.code.toLowerCase() === code));
  });
  /** The header's two buttons: the certificate and the report, when they can be opened today. */
  protected readonly certificateAction = computed(() => this.actions().find((a) => a.icon === 'certificate' && a.enabled) ?? null);
  protected readonly reportAction = computed(() => this.actions().find((a) => a.icon === 'report' && a.enabled) ?? null);
  protected readonly ncRoute = computed(() => this.actions().find((a) => a.icon === 'non-conformance')?.route ?? null);

  /** The level's flow (Admin → Certification Levels): Remote only / Onsite only have no desktop step. */
  private readonly flow = computed(() => {
    const code = this.level().toLowerCase();
    return this.levels.levels()?.find((l) => l.code.toLowerCase() === code)?.assessmentFlow ?? null;
  });
  private readonly options = computed(() => progressOptions(this.type() ?? 'Bronze', this.flow()));
  protected readonly progress = computed(() => progressSteps(this.status(), this.options()));
  protected readonly timeline = computed(() => timelineItems(this.status(), this.options()));

  /** "Your next step", from the current state and the page's own links. */
  protected readonly next = computed<NextStep | null>(() => {
    if (!this.data()) return null;
    const kind = this.kind();
    const find = (icon: string, label?: RegExp) => this.actions().find((a) => a.icon === icon && a.enabled && (!label || label.test(a.label)));
    if (kind !== 'milestone' && this.has('GetCertified')) {
      return {
        title: 'Avail your incentives',
        text: `Your ${this.levelTitle()} certification opens incentives from the Ministry of MSME, States/UTs and financial institutions.`,
        label: 'View my incentives',
        href: this.incentiveUrl(),
      };
    }
    const nc = ncBlock(this.status());
    const last = nc?.rounds[nc.rounds.length - 1];
    if (nc && last && !last.submitted && !nc.closed) {
      return {
        title: 'Respond to the non-conformances',
        text: nc.finalClosure ? `ZED raised non-conformances. Final closure date: ${nc.finalClosure}.` : 'ZED raised non-conformances.',
        label: 'View non-conformances',
        route: this.ncRoute() ?? undefined,
      };
    }
    const { steps, current } = this.progress();
    const step = steps[current];
    if (!step) return null;
    if (kind !== 'milestone' && kind !== 'surveillance' && step.label === 'Information & documents') {
      return { title: 'Basic information & documents', text: 'Enter your basic information and upload the documents in the ZED MSME mobile app.' };
    }
    const site = kind !== 'milestone' ? find('basicInfo', /onsite|surveillance assessment/i) : find('basicInfo', /milestone/i);
    return {
      title: step.label,
      text: step.note && step.note !== 'Your next step' ? step.note : kind === 'milestone' && current === 2 ? 'Review the milestone and accept it.' : 'This step is with ZED; nothing is needed from you now.',
      label: site ? site.label : undefined,
      route: site?.route,
    };
  });

  /** "Go further": the next enabled level once this one is certified and the next is not paid for yet. */
  protected readonly further = signal<GoFurther | null>(null);
  protected readonly furtherLogo = computed(() => (this.further() ? levelLogo(this.further()!.level) : ''));

  protected readonly actions = computed<Action[]>(() => {
    const type = this.type();
    if (!type || !this.data()) return [];
    const has = (field: string) => this.has(field);
    const basicInfo = 'View basic information & documents';
    const ncRaised = has('Nc1Raised');
    const list: Action[] = [];

    // Assessment pages take the level without "Surveillance", except the Silver/Gold surveillance
    // non-conformances, which have their own rounds (as the old CertificationDetails page linked them).
    const baseLevel = type.replace('Surveillance', '');
    const basicInfoRoute = this.webEntry() ? `/msme/entry/${type}` : `/msme/assessment/basic-info/${baseLevel}`;
    const ncRoute = `/msme/assessment/non-conformances/${type === 'BronzeSurveillance' ? 'Bronze' : type}`;
    // ZED-X and the added levels: the NCs (answered in the app) shown on the entry page.
    const nc: Action = this.webEntry()
      ? { icon: 'non-conformance', label: 'Non-conformance history', enabled: true, danger: true, route: `/msme/entry/${type}` }
      : { icon: 'non-conformance', label: 'Non-conformance history', enabled: true, danger: true, route: ncRoute };
    const siteRoute = `/msme/site-assessment/${this.kind() === 'surveillance' ? baseLevel : type}`;

    switch (this.kind()) {
      case 'bronze':
        list.push({ icon: 'basicInfo', label: basicInfo, enabled: this.num(this.cert(), 'BronzeStatus') > 1, route: basicInfoRoute });
        if (ncRaised) list.push(nc);
        break;
      case 'silverGold':
        list.push(this.webEntry()
          ? { icon: 'basicInfo', label: basicInfo, enabled: this.num(this.cert(), `${type}Status`) >= 1, route: basicInfoRoute }
          : { icon: 'basicInfo', label: basicInfo, enabled: has('DesktopVerification'), route: basicInfoRoute });
        // A level the Admin added with desktop assessment only has no site visit (2026-11-08).
        if (levelMode(this.level()) !== 'Desktop') {
          list.push({ icon: 'basicInfo', label: 'View onsite/remote assessment information', enabled: has('ScheduledOn'), route: siteRoute });
        }
        if (ncRaised) list.push(nc);
        break;
      case 'surveillance':
        list.push({ icon: 'basicInfo', label: basicInfo, enabled: true, route: basicInfoRoute });
        if (type !== 'BronzeSurveillance') {
          list.push({ icon: 'basicInfo', label: 'View onsite/remote assessment information', enabled: true, route: siteRoute });
          list.push({ icon: 'basicInfo', label: 'View surveillance assessment information', enabled: has('ScheduledOn'), route: siteRoute });
        }
        if (ncRaised) list.push(nc);
        break;
      case 'milestone':
        list.push({ icon: 'basicInfo', label: `View milestone ${this.milestone()}`, enabled: has('CompletedOn'), route: siteRoute });
        list.push({ icon: 'report', label: 'View report', enabled: has('CompletedOn'), href: this.reportUrl(), newTab: true });
        break;
    }

    const certified = has('GetCertified');
    if (this.kind() === 'bronze' || this.kind() === 'silverGold') {
      list.push({ icon: 'certificate', label: 'Download certificate (PDF)', enabled: certified, href: this.certificateUrl(), download: true });
      list.push({ icon: 'report', label: 'View assessment report', enabled: certified, href: this.reportUrl(), newTab: true });
      list.push({ icon: 'incentives', label: 'View my incentives', enabled: certified, href: this.incentiveUrl() });
    } else if (this.kind() === 'surveillance') {
      list.push({ icon: 'certificate', label: 'Download surveillance certificate (PDF)', enabled: certified, href: this.certificateUrl(), download: true });
      list.push({ icon: 'report', label: 'View surveillance report', enabled: certified, href: this.reportUrl(), newTab: true });
      list.push({ icon: 'incentives', label: 'View my incentives', enabled: true, href: this.incentiveUrl() });
    }
    // A download whose address cannot be built (no certificate path yet, settings not loaded) stays disabled.
    return list.map((a) => (a.href === '' ? { ...a, enabled: false } : a));
  });

  constructor() {
    effect(() => {
      const type = this.type();
      untracked(() => void this.load(type));
    });
    effect(() => {
      const certified = !!this.data() && (this.kind() === 'bronze' || this.kind() === 'silverGold') && this.has('GetCertified');
      const level = this.level();
      untracked(() => void this.loadFurther(certified ? level : null));
    });
  }

  /** The next level after this one (Admin's order, enabled), its payment flag and the unit's fee (dashboard API). */
  private async loadFurther(level: string | null): Promise<void> {
    this.further.set(null);
    if (!level) return;
    const list = allLevels();
    const i = list.findIndex((l) => l.code.toLowerCase() === level.toLowerCase());
    const nextLevel = i < 0 ? undefined : list.slice(i + 1).find((l) => l.isEnabled);
    if (!nextLevel) return;
    try {
      const [dash, fees] = await Promise.all([
        firstValueFrom(this.http.get<{ msme?: Row }>('/api/msme/dashboard')),
        firstValueFrom(this.http.get<Record<string, number | null>>('/api/msme/dashboard/level-fees')).catch(() => null),
      ]);
      const paid = dash?.msme?.[`Is${nextLevel.code}PaymentDone`];
      // Only when the dashboard says the next level is not paid for (no flag: not shown). 2026-11-18: an empty flag (NULL in
      // Msme for a level never paid for) is "not paid", as the dashboard's own Apply reads it.
      if (paid === undefined || Number(paid) === 1 || level !== this.level()) return;
      const fee = fees?.[nextLevel.code];
      this.further.set({ level: nextLevel.code, fee: typeof fee === 'number' ? fee : null });
    } catch {
      this.further.set(null);
    }
  }

  /** A fee as ₹ 5,000 (Indian grouping). */
  protected rupees(fee: number): string {
    return `₹ ${Math.round(fee).toLocaleString('en-IN')}`;
  }

  protected levelLabel(code: string): string {
    return levelName(code);
  }

  protected refresh(): void {
    void this.load(this.type());
  }

  private async load(type: string | null): Promise<void> {
    const request = ++this.request;
    this.error.set('');
    if (!type) {
      this.data.set(null);
      this.error.set('Invalid certification.');
      return;
    }
    this.loading.set(true);
    try {
      const [config, data] = await Promise.all([
        this.config.get().catch(() => null),
        firstValueFrom(this.api.get(type)),
      ]);
      if (request !== this.request) return;
      this.legacyUrl.set(config?.legacyPortalUrl ?? '');
      this.data.set(data);
    } catch (err) {
      if (request !== this.request) return;
      this.data.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  // ----- helpers -----

  /** Truthy like an AngularJS ng-show expression. */
  private has(field: string): boolean {
    return !!statusText(this.status(), field);
  }

  private anyStatus(): boolean {
    return Object.keys(this.status()).some((f) => this.has(f));
  }

  /** Basic information and documents submitted (a date, or a description other than "In-progress"). */
  private infoDone(): boolean {
    const t = statusText(this.status(), 'BasicInfoStatus');
    return !!t && (!!splitDate(t).date || !/progress|pending/i.test(t));
  }

  protected num(row: Row, field: string): number {
    return Number(row[field] ?? 0) || 0;
  }

  /**
   * Certificates come from api/msme/certification-documents (the signed-in MSME only). Bronze/Silver/Gold are
   * drawn there if the file is missing; a surveillance certificate is only served once the surveillance
   * system has stored it, which SurveCertPath ({Surveillance/}Certificates|Certifications) signals.
   */
  private certificateUrl(): string {
    const level = this.level();
    if (this.kind() !== 'surveillance') return `${DOCUMENTS_API}/${level}/certificate`;
    return CERT_PATH.test(String(this.cert()['SurveCertPath'] ?? '')) ? `${DOCUMENTS_API}/${level}Surveillance/certificate` : '';
  }

  /**
   * The report page of the signed-in MSME (2026-11-15: built from the live data, with Download PDF; nothing is stored):
   * Bronze/Silver/Gold from this portal's database, surveillance reports from ZED_SURVEILLANCE and handholding milestone
   * reports from ZED_CONSULTANT (read-only connections). An earlier milestone's stored PDF opens from that page.
   */
  private reportUrl(): string {
    const kind = this.kind() === 'surveillance' ? 'surveillance' : this.kind() === 'milestone' ? 'milestone' : 'assessment';
    return reportRoute({ kind, level: this.level(), milestone: kind === 'milestone' ? this.milestone() : undefined });
  }
}
