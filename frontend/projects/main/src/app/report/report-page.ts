import { DOCUMENT, NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, InjectionToken, OnInit, computed, inject, input, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { withApiBase } from '../api-base';
import { REPORT_KINDS, ReportKind, ReportPage, ReportTarget, reportApiUrl, reportLinkApiUrl } from './report.api';
import { TextPipe, t } from '../content/page-text';

/** Opens the browser's print dialog (replaced in tests). */
export const PRINT_PAGE = new InjectionToken<() => void>('PRINT_PAGE', { providedIn: 'root', factory: () => () => window.print() });

interface Chip { id: string; label: string }

/** A handholding milestone's name (the report page's toolbar). */
function milestoneName(n: number): string {
  switch (n) {
    case 1: return t('common.report.milestone1Name', 'BDSR / HAP');
    case 2: return t('common.report.milestone2Name', 'Progress review 1');
    case 3: return t('common.report.milestone3Name', 'Progress review 2');
    default: return '';
  }
}

/**
 * A ZED report as a page (2026-11-15, docs/designs/reports-html.html): the assessment, surveillance or handholding milestone
 * report, built by the server from the live data each time it is opened (nothing is stored), shown as A4 sheets with a toolbar.
 * Print and Download PDF both open the browser's print dialog: Download PDF names the file and the reader chooses "Save as PDF"
 * (no PDF library; @media print in styles/_report.scss gives clean A4 pages and hides the toolbar).
 * <ul>
 * <li>/msme/report/{kind}/{level}[?record=…|?milestone=n]: the signed-in MSME's own report.</li>
 * <li>/staff/report/{kind}/{level}/{zedId}[?milestone=n]: a record staff may see (also a DRAFT before the final submit).</li>
 * <li>/report/link?t=…: a signed link from the ZED MSME, assessor or consultant app (no web sign-in), valid for 10 minutes.</li>
 * </ul>
 * The styles are global (styles/_report.scss, scoped under .zed-report): the component style budget is 8 kB.
 */
/** A route input as text: '' when the address does not carry it. */
const orEmpty = (value: string | number | null | undefined): string => (value == null ? '' : String(value));

/** "ZED Silver", and "ZED-X" itself (never "ZED ZED-X"). */
export const zedTitle = (name: string | null | undefined): string => {
  const n = (name ?? '').trim();
  return /^zed/i.test(n) ? n : `ZED ${n}`;
};

@Component({
  selector: 'zed-report-page',
  imports: [NgTemplateOutlet, UpperCasePipe, TextPipe],
  templateUrl: './report-page.html',
})
export class ReportPageView implements OnInit {
  /**
   * Route parameters and query parameters (component input binding). The router sets an input the address does not carry
   * to undefined (not to the default), so each one is read as '' then.
   */
  readonly kind = input('', { transform: orEmpty });
  readonly level = input('', { transform: orEmpty });
  readonly zedId = input('', { transform: orEmpty });
  readonly record = input('', { transform: orEmpty });
  readonly milestone = input('', { transform: orEmpty });
  /** /report/link?t=… (the query parameter t). */
  readonly token = input('', { alias: 't', transform: orEmpty });

  private readonly http = inject(HttpClient);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);
  private readonly print = inject(PRINT_PAGE);

  protected readonly report = signal<ReportPage | null>(null);
  protected readonly zedTitle = zedTitle;
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly toolbarTitle = computed(() => {
    const r = this.report();
    if (!r) return t('common.report.title', 'ZED Report');
    if (r.kind === 'milestone') {
      const n = r.milestone?.number ?? 0;
      const name = milestoneName(n);
      return name
        ? t('common.report.milestoneNamedTitle', 'Handholding Report · Milestone {no} ({name})', { no: n, name })
        : t('common.report.milestoneTitle', 'Handholding Report · Milestone {no}', { no: n });
    }
    const level = zedTitle(r.levelName);
    return r.kind === 'surveillance'
      ? t('common.report.surveillanceTitle', 'Surveillance Report · {level}', { level })
      : t('common.report.assessmentTitle', 'Assessment Report · {level}', { level });
  });

  /** The section chips of the toolbar; each scrolls to its sheet. */
  protected readonly chips = computed<Chip[]>(() => {
    const r = this.report();
    if (!r || r.storedPdf) return [];
    if (r.kind === 'milestone') {
      const m = r.milestone;
      return [
        { id: 'rp-cover', label: t('common.report.chip.cover', 'Cover') },
        { id: 'rp-overview', label: t('common.report.chip.overview', 'Overview') },
        ...(m && (m.gaps.length || m.progress)
          ? [{ id: 'rp-plan', label: m.number === 1 ? t('common.report.chip.gapsPlan', 'Gaps and plan') : t('common.report.chip.progress', 'Progress') }] : []),
        { id: 'rp-unit', label: t('common.report.chip.unit', 'Unit details') },
        ...(m?.meetings.length ? [{ id: 'rp-meetings', label: t('common.report.chip.meetings', 'Meetings') }] : []),
        { id: 'rp-way', label: t('common.report.chip.way', 'Way forward') },
      ];
    }
    return [
      { id: 'rp-cover', label: t('common.report.chip.cover', 'Cover') },
      { id: 'rp-summary', label: t('common.report.chip.summary', 'Summary') },
      { id: 'rp-unit', label: t('common.report.chip.unit', 'Unit details') },
      ...(r.findings.length ? [{ id: 'rp-findings', label: t('common.report.chip.findings', 'Findings') }] : []),
      ...(r.ncRounds.length ? [{ id: 'rp-nc', label: t('common.report.chip.nc', 'Non-conformances') }] : []),
      { id: 'rp-way', label: t('common.report.chip.way', 'Way forward') },
    ];
  });

  /** "ZED-MH-0001 · ZED Silver" under the sheet title. */
  protected readonly subtitle = computed(() => {
    const r = this.report();
    if (!r) return '';
    if (r.kind === 'milestone') return `${r.zedId} · Milestone ${r.milestone?.number ?? ''} · ${r.milestone?.existing ? r.milestone.existing + ' → ' : ''}${r.levelName}`;
    return `${r.zedId} · ${zedTitle(r.levelName)}`;
  });

  ngOnInit(): void {
    void this.load();
  }

  /** CSS class of a level's medal (Bronze, Silver, Gold); other levels show their badge or a neutral medal. */
  protected medal(level: string): string {
    const code = level.toLowerCase();
    return code === 'bronze' || code === 'silver' || code === 'gold' ? `rp-medal rp-m-${code}` : 'rp-medal rp-m-other';
  }

  protected levelOf(name: string): string {
    return name.replace(/^ZED\s+/i, '');
  }

  protected width(part: number, total: number): number {
    return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
  }

  protected mapLink(r: ReportPage): string {
    const lat = Number(r.unit?.latitude);
    const lng = Number(r.unit?.longitude);
    return r.unit?.latitude && r.unit?.longitude && Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.google.com/maps?q=${lat},${lng}` : '';
  }

  /** Photo and file addresses of the API: under /Consultancy or /surveillance on those portals. */
  protected api(url: string | null | undefined): string {
    return url ? withApiBase(url) : '';
  }

  protected scrollTo(id: string): void {
    this.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected doPrint(): void {
    this.print();
  }

  /** The browser's print dialog, with the report's file name as the suggested name ("Save as PDF"). */
  protected downloadPdf(): void {
    const r = this.report();
    const before = this.title.getTitle();
    if (r?.fileName) this.title.setTitle(r.fileName);
    try {
      this.print();
    } finally {
      this.title.setTitle(before);
    }
  }

  private target(): ReportTarget | null {
    const kind = this.kind() as ReportKind;
    // Any level of Administration → Certification Levels; the server knows them all (and answers 400/404 otherwise).
    const level = this.level().trim();
    if (!REPORT_KINDS.includes(kind) || !/^[A-Za-z][A-Za-z0-9]{1,19}$/.test(level)) return null;
    const milestone = Number(this.milestone() || 0);
    if (kind === 'milestone' && !(milestone >= 1 && milestone <= 3)) return null;
    const zedId = this.zedId().trim();
    const record = this.record().trim();
    if ((zedId && !/^[A-Za-z0-9_]{1,50}$/.test(zedId)) || (record && !/^[A-Za-z0-9_]{1,50}$/.test(record))) return null;
    return { kind, level, zedId: zedId || undefined, record: record || undefined, milestone: kind === 'milestone' ? milestone : undefined };
  }

  private async load(): Promise<void> {
    const token = this.token().trim();
    const target = token ? null : this.target();
    if (!token && !target) {
      this.loading.set(false);
      this.error.set(t('common.report.addressError', 'This report address is not valid.'));
      return;
    }
    try {
      const r = await firstValueFrom(this.http.get<ReportPage>(token ? reportLinkApiUrl(token) : reportApiUrl(target!)));
      this.report.set(r);
      this.title.setTitle(`ZED | ${r.title}`);
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 404
          ? token
            ? t('common.report.linkExpiredError', 'This report link has expired or is not valid. Please open the report again from the app.')
            : t('common.report.notAvailableError', 'This report is not available.')
          : apiErrorMessage(err),
      );
    } finally {
      this.loading.set(false);
    }
  }
}
