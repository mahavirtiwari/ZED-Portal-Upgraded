import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CertificationSteps } from './certification-steps';
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
  wide?: boolean;
}

/** Folder of a stored surveillance certificate: {SurveCertPath}/DA|SA/{ZedId}/{Level}.pdf. */
const CERT_PATH = /^Surveillance\/Certifica(tions|tes)$/;

/** Certificates and reports of the signed-in MSME (authorised downloads). */
const DOCUMENTS_API = '/api/msme/certification-documents';

/**
 * Status and actions of one certification (Bronze, Silver, Gold, their surveillance, or a
 * handholding milestone). Port of Views/Msme/CertificationDetails.cshtml. Assessment pages,
 * certificates and Bronze/Silver/Gold reports open in this portal; surveillance and milestone reports
 * and incentives still open on the old portal.
 */
@Component({
  selector: 'zed-msme-certification-details',
  imports: [RouterLink, CertificationSteps],
  templateUrl: './certification-details.html',
  styleUrl: './certification-details.scss',
})
export class CertificationDetailsPage {
  /** Route parameter :certification. */
  readonly certification = input.required<string>();

  private readonly api = inject(CertificationApi);
  private readonly config = inject(ClientConfigService);
  private request = 0;

  protected readonly data = signal<CertificationData | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly legacyUrl = signal('');

  protected readonly type = computed(() => canonicalCertification(this.certification()));
  protected readonly kind = computed(() => certificationKind(this.type() ?? 'Bronze'));
  protected readonly level = computed(() => certificationLevel(this.type() ?? 'Bronze'));
  protected readonly milestone = computed(() => milestoneNumber(this.type() ?? ''));

  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly basic = computed<Row>(() => this.data()?.basicInfo ?? {});
  protected readonly cert = computed<Row>(() => this.data()?.certStatus ?? {});
  protected readonly status = computed<Row>(() => this.data()?.status ?? {});

  /** The mobile app banner was shown for every type except Bronze surveillance and the milestones. */
  protected readonly showAppBanner = computed(() =>
    ['Bronze', 'Silver', 'Gold', 'SilverSurveillance', 'GoldSurveillance'].includes(this.type() ?? ''),
  );

  protected readonly pledgeCertificateUrl = '/api/msme/files/pledge-certificate';

  protected readonly incentiveUrl = computed(() => incentiveUrl(this.data()));

  protected readonly actions = computed<Action[]>(() => {
    const type = this.type();
    if (!type || !this.data()) return [];
    const has = (field: string) => this.has(field);
    const basicInfo = 'View Basic Information & Documents Upload';
    const ncRaised = has('Nc1Raised');
    const list: Action[] = [];

    // Assessment pages take the level without "Surveillance", except the Silver/Gold surveillance
    // non-conformances, which have their own rounds (as the old CertificationDetails page linked them).
    const baseLevel = type.replace('Surveillance', '');
    const basicInfoRoute = `/msme/assessment/basic-info/${baseLevel}`;
    const ncRoute = `/msme/assessment/non-conformances/${type === 'BronzeSurveillance' ? 'Bronze' : type}`;
    const nc: Action = { icon: 'non-conformance', label: 'Non-Conformance(s)', enabled: true, danger: true, route: ncRoute };
    const siteRoute = `/msme/site-assessment/${this.kind() === 'surveillance' ? baseLevel : type}`;

    switch (this.kind()) {
      case 'bronze':
        list.push({ icon: 'basicInfo', label: basicInfo, enabled: this.num(this.cert(), 'BronzeStatus') > 1, route: basicInfoRoute });
        if (ncRaised) list.push(nc);
        break;
      case 'silverGold':
        list.push({ icon: 'basicInfo', label: basicInfo, enabled: has('DesktopVerification'), route: basicInfoRoute });
        list.push({ icon: 'basicInfo', label: 'View Onsite/Remote Assessment Information', enabled: has('ScheduledOn'), route: siteRoute });
        if (ncRaised) list.push(nc);
        break;
      case 'surveillance':
        list.push({ icon: 'basicInfo', label: basicInfo, enabled: true, route: basicInfoRoute });
        if (type !== 'BronzeSurveillance') {
          list.push({ icon: 'basicInfo', label: 'View Onsite/Remote Assessment Information', enabled: true, route: siteRoute });
          list.push({ icon: 'basicInfo', label: 'View Surveillance Assessment Information', enabled: has('ScheduledOn'), route: siteRoute });
        }
        if (ncRaised) list.push(nc);
        break;
      case 'milestone':
        list.push({ icon: 'basicInfo', label: `View Milestone ${this.milestone()}`, enabled: has('CompletedOn'), route: siteRoute });
        list.push({ icon: 'report', label: 'Download Report', enabled: has('CompletedOn'), href: this.reportUrl(), download: true, wide: true });
        break;
    }

    const certified = has('GetCertified');
    if (this.kind() === 'bronze' || this.kind() === 'silverGold') {
      list.push({ icon: 'certificate', label: 'Download Certificate', enabled: certified, href: this.certificateUrl(), download: true });
      list.push({ icon: 'report', label: 'Download Report', enabled: certified, href: this.reportUrl(), download: true });
      list.push({ icon: 'incentives', label: 'View My Incentives', enabled: certified, href: this.incentiveUrl() });
    } else if (this.kind() === 'surveillance') {
      list.push({ icon: 'certificate', label: 'Download Surveillance Certificate', enabled: certified, href: this.certificateUrl(), download: true });
      list.push({ icon: 'report', label: 'Download Surveillance Report', enabled: certified, href: this.reportUrl(), download: true });
      list.push({ icon: 'incentives', label: 'View My Incentives', enabled: true, href: this.incentiveUrl() });
    }
    // A download whose address cannot be built (no certificate path yet, settings not loaded) stays disabled.
    return list.map((a) => (a.href === '' ? { ...a, enabled: false } : a));
  });

  constructor() {
    effect(() => {
      const type = this.type();
      untracked(() => void this.load(type));
    });
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
    const v = this.status()[field];
    return v !== null && v !== undefined && v !== '' && v !== 0 && v !== false;
  }

  protected num(row: Row, field: string): number {
    return Number(row[field] ?? 0) || 0;
  }

  /** Address on the old portal, or '' when its base address is not known. */
  private legacy(path: string): string {
    return this.legacyUrl() ? `${this.legacyUrl()}${path}` : '';
  }

  private zedId(): string {
    return encodeURIComponent(String(this.msme()['ZedId'] ?? ''));
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

  /** Bronze/Silver/Gold reports are drawn by this portal; surveillance and milestone reports still come from those systems. */
  private reportUrl(): string {
    const level = this.level();
    switch (this.kind()) {
      case 'surveillance':
        return this.legacy(`/surveillance/SA/ReportSummary/${this.zedId()}?certification=${level}`);
      case 'milestone':
        return this.legacy(`/consultancy/SA/ReportSummary/${this.zedId()}?certification=${level}&milestone=${this.milestone()}`);
      default:
        return `${DOCUMENTS_API}/${level}/report`;
    }
  }
}
