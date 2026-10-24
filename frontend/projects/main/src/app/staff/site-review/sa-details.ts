import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM, flag, num, text, useLegacyPortal } from '../assessment/assessment-shared';
import { AssessmentApi, isZedId } from '../assessment/assessment.api';
import { RemarksTarget, ReviewActionsBar, ReviewRemarksDialog } from '../monitoring/review-actions';
import { NO_REVIEW, RemarksKind } from '../monitoring/review.api';
import { SaSurveillanceTab, SurveillanceRemarks } from './sa-surveillance';
import { Row, SaDetails, SaEvidencePhoto, SaNcProduct, SaNcRound, SaOriginal, SaPhoto, SiteReviewApi, siteLevel } from './site-review.api';

/** Tab ids of the old page (SaDetails.cshtml tabTitles). */
export const SA_TAB_TITLES: Record<number, string> = {
  1: 'Assessment Overview',
  2: 'Assessment Plan',
  3: 'Opening Meeting',
  4: 'Basic Information',
  5: 'Site Tour',
  6: 'Parameters',
  7: 'Closing Meeting',
  8: 'NC 1',
  9: 'NC 2',
  10: 'NC 3',
  11: 'NC 4',
  12: 'NC 5',
  13: 'Attendance',
};

/**
 * Staff review page of a Silver/Gold site assessment. Port of Views/Assessment/SaDetails.cshtml: read-only
 * for every role of the old page, with the agency / master-admin actions (edit remarks and OFI comments,
 * final submit, send back, reject; master admin: withdraw an exemption, send back an automatic rejection)
 * where the server allows them. The site assessor's own actions (validate, conformance, final submit) are
 * still done on the current portal; the page links there for the assessor of the unit.
 * <p>Surveillance build (that portal's SaDetails.cshtml): tabs 1-7 put the surveillance next to the original certification
 * on main ({@link SaSurveillanceTab}, loaded with the page; MasterAdmin also sees the original's blocks), the NC tabs are
 * the surveillance's, and there is no Attendance tab.</p>
 */
@Component({
  selector: 'zed-staff-sa-details',
  imports: [RouterLink, ReviewActionsBar, ReviewRemarksDialog, SaSurveillanceTab],
  templateUrl: './sa-details.html',
  host: { '(document:keydown.escape)': 'preview.set(null)' },
})
export class SaDetailsPage {
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();

  private readonly api = inject(SiteReviewApi);
  private readonly assessment = inject(AssessmentApi);
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';
  protected readonly legacy = useLegacyPortal();
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly n = num;
  protected readonly tabTitles = SA_TAB_TITLES;

  protected readonly data = signal<SaDetails | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly tab = signal(1);
  protected readonly preview = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly remarksTarget = signal<RemarksTarget | null>(null);
  /** Surveillance: the original certification from main, loaded with the page (not for QC, as before). */
  protected readonly original = signal<SaOriginal | null>(null);

  private request = 0;

  protected readonly level = computed(() => siteLevel(this.certification()));
  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly perms = computed(() => this.data()?.permissions ?? { review: NO_REVIEW, canWithdrawExemption: false, assessorOnCurrentPortal: false });
  protected readonly review = computed(() => this.perms().review ?? NO_REVIEW);
  protected readonly isQc = computed(() => this.data()?.role === 'QC');
  /** Surveillance: the original certification's blocks were shown to MasterAdmin only. */
  protected readonly isAdmin = computed(() => this.data()?.role === 'MasterAdmin');
  /** NC tabs of the old page: NC n when NcCount > n - 1. */
  protected readonly ncTabs = computed(() => (this.data()?.ncRounds ?? []).map((r) => r.ncCount).filter((nc) => num(this.msme(), 'NcCount') > nc - 1));

  constructor() {
    effect(() => {
      const zedId = this.zedId();
      const level = this.level();
      untracked(() => void this.load(zedId, level, true));
    });
  }

  // ------------------------------------------------------------------ view helpers

  protected round(nc: number): SaNcRound | undefined {
    return this.data()?.ncRounds.find((r) => r.ncCount === nc);
  }

  protected requirementsOf(section: Row, rows: Row[] | undefined): Row[] {
    return (rows ?? []).filter((r) => text(r, 'SectionCode') === text(section, 'SectionCode'));
  }

  protected optionsOf(r: Row, rows: Row[] | undefined): Row[] {
    return (rows ?? []).filter((o) => text(o, 'SectionCode') === text(r, 'SectionCode') && text(o, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected subOptionsOf(o: Row, rows: Row[] | undefined): Row[] {
    return (rows ?? []).filter(
      (s) => text(s, 'SectionCode') === text(o, 'SectionCode') && text(s, 'RequirementCode') === text(o, 'RequirementCode') && text(s, 'OptionCode') === text(o, 'OptionCode'),
    );
  }

  protected evidencesOf(r: Row, rows: Row[] | undefined): Row[] {
    return (rows ?? []).filter((e) => text(e, 'SectionCode') === text(r, 'SectionCode') && text(e, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected requirementPhotos(r: Row): SaPhoto[] {
    const p = r['Photos'];
    return Array.isArray(p) ? (p as SaPhoto[]) : [];
  }

  protected evidencePhotosOf(r: Row): SaEvidencePhoto[] {
    return (this.data()?.evidencePhotos ?? []).filter((p) => p.sectionCode === text(r, 'SectionCode') && p.requirementCode === text(r, 'RequirementCode'));
  }

  protected oldProductsOf(p: SaNcProduct, nc: number): SaNcProduct[] {
    return (this.round(nc)?.oldProducts ?? []).filter((o) => o.productParentId === p.productParentId);
  }

  /** Earlier rounds of an NC product, then the product itself (the old page's two rows). */
  protected productRows(p: SaNcProduct, nc: number): SaNcProduct[] {
    return [...this.oldProductsOf(p, nc), p];
  }

  protected attendanceOf(consultant: Row): Row[] {
    return (this.data()?.attendance ?? []).filter((a) => text(a, 'ConsultantId') === text(consultant, 'ConsultantId'));
  }

  protected mapUrl(lat: unknown, lng: unknown): string {
    const a = Number(lat);
    const b = Number(lng);
    return lat && lng && Number.isFinite(a) && Number.isFinite(b) ? `https://www.google.com/maps?q=${a},${b}` : '';
  }

  protected openImage(src: string | null | undefined): void {
    if (src) this.preview.set(src);
  }

  // ------------------------------------------------------------------ agency / master-admin review

  protected editRemarks(kind: RemarksKind | 'ofi', id: unknown, remarks: string | null | undefined): void {
    if (!this.review().editRemarks) return;
    this.remarksTarget.set({ kind, id, remarks: remarks ?? '' });
  }

  protected editSurveillanceRemarks(r: SurveillanceRemarks): void {
    this.editRemarks(r.kind, r.id, r.remarks);
  }

  protected async reviewed(message: string): Promise<void> {
    this.remarksTarget.set(null);
    this.notice.set({ ok: true, text: message });
    await this.reload();
  }

  /** Master admin: "Exempted from Remote/Site Assessment" Yes → No while the site assessment is scheduled. */
  protected async withdrawExemption(section: Row): Promise<void> {
    const d = this.data();
    if (!d || !this.perms().canWithdrawExemption) return;
    this.busy.set(true);
    try {
      const res = await firstValueFrom(this.assessment.exemption(d.zedId, d.certification, section['Id'], 'No'));
      this.notice.set({ ok: true, text: res.message });
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
    await this.reload();
  }

  protected refresh(): void {
    void this.reload();
  }

  // ------------------------------------------------------------------ plumbing

  private reload(): Promise<void> {
    return this.load(this.zedId(), this.level(), false);
  }

  /**
   * Surveillance: main's original certification (the page's skeleton and MasterAdmin's ONSITE blocks). Without it
   * (not found on main, or main not reachable) the surveillance's own data is shown.
   */
  private async loadOriginal(d: SaDetails): Promise<void> {
    // A later load of another unit wins; reloads of the same unit keep the original.
    const same = () => this.data()?.zedId === d.zedId && this.data()?.certification === d.certification;
    try {
      const original = await firstValueFrom(this.api.original(d.zedId, d.certification));
      if (same()) this.original.set(original);
    } catch {
      if (same()) this.original.set(null);
    }
  }

  private async load(zedId: string, level: string | null, first: boolean): Promise<void> {
    const request = ++this.request;
    this.error.set('');
    if (!isZedId(zedId) || !level) {
      this.data.set(null);
      this.error.set('Invalid request.');
      return;
    }
    this.loading.set(true);
    try {
      const data = await firstValueFrom(this.api.details(zedId, level));
      if (request !== this.request) return;
      this.data.set(data);
      if (first) {
        this.tab.set(1);
        this.original.set(null);
        if (this.surveillance && data.surveillance?.hasOriginal && data.role !== 'QC') void this.loadOriginal(data);
      }
    } catch (err) {
      if (request !== this.request) return;
      this.data.set(null);
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 404
          ? 'Assessment details are not available, or this assessment is not allotted to you.'
          : apiErrorMessage(err),
      );
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
