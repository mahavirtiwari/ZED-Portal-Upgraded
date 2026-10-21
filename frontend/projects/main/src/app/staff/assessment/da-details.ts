import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ReviewActionsBar, ReviewRemarksDialog, RemarksTarget } from '../monitoring/review-actions';
import { NO_REVIEW, RemarksKind } from '../monitoring/review.api';
import { flag, num, text } from './assessment-shared';
import { AssessmentApi, DaDetails, FinalSubmitCheck, NcRound, OpenedType, Row, canonicalLevel, isZedId } from './assessment.api';

/** Tab ids of the old page: 1 overview, 2 basic info, 9 ESG, 3 parameters, 4..8 NC1..NC5. */
export const TAB_TITLES: Record<number, string> = {
  1: 'Assessment Summary',
  2: 'Basic Information',
  3: 'Parameters',
  4: 'Non-Conformance(s) 1',
  5: 'Non-Conformance(s) 2',
  6: 'Non-Conformance(s) 3',
  7: 'Non-Conformance(s) 4',
  8: 'Non-Conformance(s) 5',
  9: 'Esg Compliance',
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5;

interface ConformanceEdit { requirement: Row; conformance: string; remarks: string }
interface ValidationEdit { row: Row | null; verified: string; remarks: string }
interface EvidenceEdit { evidence: Row; verified: string; source: string; remarks: string; files: File[] }
interface FinalSubmitEdit { check: FinalSubmitCheck; remarks: string; confirmed: boolean }

/**
 * Desktop assessment review page. Port of Views/Assessment/DaDetails.cshtml for the desktop assessor
 * (validate photos, products, evidences and conformance, exemptions, final submit) and read-only for
 * the other roles of the old page, with the agency / master-admin review actions (edit remarks, final
 * submit, send back, reject: the old Monitoring actions) where the server allows them (`permissions.review`).
 * Bootstrap tabs and modals are signal-controlled markup.
 */
@Component({
  selector: 'zed-staff-da-details',
  imports: [FormsModule, RouterLink, ReviewActionsBar, ReviewRemarksDialog],
  templateUrl: './da-details.html',
  host: { '(document:keydown.escape)': 'preview.set(null)' },
})
export class DaDetailsPage {
  /** Route parameters. */
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();

  private readonly api = inject(AssessmentApi);
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly n = num;
  protected readonly tabTitles = TAB_TITLES;

  protected readonly data = signal<DaDetails | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly tab = signal(1);
  protected readonly preview = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly modalError = signal('');

  protected readonly conformanceEdit = signal<ConformanceEdit | null>(null);
  protected readonly productEdit = signal<ValidationEdit | null>(null);
  protected readonly siteExteriorEdit = signal<ValidationEdit | null>(null);
  protected readonly evidenceEdit = signal<EvidenceEdit | null>(null);
  protected readonly finalSubmitEdit = signal<FinalSubmitEdit | null>(null);

  private request = 0;

  protected readonly level = computed(() => canonicalLevel(this.certification()));
  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly perms = computed(() => this.data()?.permissions ?? { canAssess: false, canFinalSubmit: false, canWithdrawExemption: false, review: NO_REVIEW });
  protected readonly review = computed(() => this.perms().review ?? NO_REVIEW);
  protected readonly remarksTarget = signal<RemarksTarget | null>(null);
  protected readonly isAssessorRole = computed(() => this.data()?.role === 'DesktopAssessor');
  protected readonly isQc = computed(() => this.data()?.role === 'QC');
  protected readonly status = computed(() => num(this.msme(), 'CertificationStatus'));
  protected readonly ncCount = computed(() => num(this.msme(), 'NcCount'));
  /** Round the assessor works on: 0 before the first final submit, else the current NC round. */
  protected readonly currentRound = computed(() => (this.status() === 4 ? this.ncCount() : 0));

  protected readonly selfies = computed(() => (this.data()?.photos ?? []).filter((p) => text(p, 'PhotoType') === 'Selfie'));
  protected readonly siteExterior = computed(() => (this.data()?.photos ?? []).filter((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos'));
  protected readonly esg = computed(() => (this.data()?.esgCheckList ?? []).filter((r) => text(r, 'CheckListType') === 'ESG'));
  protected readonly social = computed(() => (this.data()?.esgCheckList ?? []).filter((r) => text(r, 'CheckListType') === 'SOCIAL/OHS'));

  /** NC tabs shown on the old page: NC n when NcCount and SecNcCount are at least n. */
  protected readonly ncTabs = computed(() => {
    const m = this.msme();
    return (this.data()?.ncRounds ?? []).map((r) => r.ncCount).filter((n) => num(m, 'NcCount') > n - 1 && num(m, 'SecNcCount') > n - 1);
  });

  protected readonly mapUrl = computed(() => {
    const l = this.data()?.location;
    const lat = Number(l?.['Latitude']);
    const lng = Number(l?.['Longitude']);
    return Number.isFinite(lat) && Number.isFinite(lng) && l?.['Latitude'] ? `https://www.google.com/maps?q=${lat},${lng}` : '';
  });

  constructor() {
    effect(() => {
      const zedId = this.zedId();
      const level = this.level();
      untracked(() => void this.load(zedId, level, true));
    });
  }

  // ------------------------------------------------------------------ view helpers

  protected round(n: number): NcRound | undefined {
    return this.data()?.ncRounds.find((r) => r.ncCount === n);
  }

  /** Site exterior photos of the round before NC n (round 0 for NC1). */
  protected previousPhotos(n: number): Row[] {
    const photos = n <= 1 ? (this.data()?.photos ?? []) : (this.round(n - 1)?.photos ?? []);
    return photos.filter((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos');
  }

  protected roundPhotos(n: number): Row[] {
    return (this.round(n)?.photos ?? []).filter((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos');
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

  protected oldProductsOf(p: Row, n: number): Row[] {
    return (this.round(n)?.oldProducts ?? []).filter((o) => text(o, 'ProductParentId') === text(p, 'ProductParentId'));
  }

  protected screenshots(e: Row): string[] {
    const s = e['Screenshots'];
    return Array.isArray(s) ? (s as string[]) : [];
  }

  /** The assessor may change rows of this round now. */
  protected canChange(round: number): boolean {
    return this.perms().canAssess && this.currentRound() === round;
  }

  protected noRows(rows: Row[], column: string): Row[] {
    return rows.filter((r) => text(r, column) === 'No');
  }

  // ------------------------------------------------------------------ opening documents

  protected openImage(src: unknown, type?: OpenedType, row?: Row): void {
    if (typeof src === 'string' && src) this.preview.set(src);
    if (type && row) this.markOpened(type, row);
  }

  /** Records that the assessor opened a document (the old SaveTimestamp), then refreshes the page data. */
  protected markOpened(type: OpenedType, row: Row): void {
    if (!this.perms().canAssess) return;
    const d = this.data();
    if (!d) return;
    firstValueFrom(this.api.opened(d.zedId, d.certification, type, row['Id']))
      .then(() => this.reload())
      .catch((err) => this.notice.set({ ok: false, text: apiErrorMessage(err) }));
  }

  // ------------------------------------------------------------------ assessor actions

  protected editConformance(r: Row): void {
    this.modalError.set('');
    this.conformanceEdit.set({ requirement: r, conformance: text(r, 'Conformance'), remarks: text(r, 'AssessorRemarks') });
  }

  protected async saveConformance(): Promise<void> {
    const e = this.conformanceEdit();
    const d = this.data();
    if (!e || !d) return;
    if (!e.conformance) return this.modalError.set('Please select the conformance.');
    if (e.conformance === 'No' && !e.remarks.trim()) return this.modalError.set('Please enter remarks.');
    await this.save(this.api.conformance(d.zedId, d.certification, e.requirement['Id'], e.conformance, e.remarks.trim()), () => this.conformanceEdit.set(null));
  }

  protected editProduct(p: Row): void {
    this.modalError.set('');
    this.productEdit.set({ row: p, verified: text(p, 'IsVerified'), remarks: text(p, 'AssessorRemarks') });
  }

  protected async saveProduct(): Promise<void> {
    const e = this.productEdit();
    const d = this.data();
    if (!e?.row || !d) return;
    if (!this.validation(e)) return;
    await this.save(this.api.validateProduct(d.zedId, d.certification, e.row['Id'], e.verified, e.remarks.trim()), () => this.productEdit.set(null));
  }

  protected editSiteExterior(first: Row | undefined): void {
    this.modalError.set('');
    this.siteExteriorEdit.set({ row: null, verified: text(first, 'IsVerified'), remarks: text(first, 'AssessorRemarks') });
  }

  protected async saveSiteExterior(): Promise<void> {
    const e = this.siteExteriorEdit();
    const d = this.data();
    if (!e || !d) return;
    if (!this.validation(e)) return;
    await this.save(this.api.validateSiteExterior(d.zedId, d.certification, e.verified, e.remarks.trim()), () => this.siteExteriorEdit.set(null));
  }

  protected editEvidence(ev: Row): void {
    this.modalError.set('');
    this.evidenceEdit.set({ evidence: ev, verified: text(ev, 'IsVerified'), source: text(ev, 'SourceOfValidation'), remarks: text(ev, 'AssessorRemarks'), files: [] });
  }

  protected pickFiles(event: Event): void {
    const e = this.evidenceEdit();
    if (!e) return;
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    const ok = files.length <= MAX_FILES && files.every((f) => f.size > 0 && f.size <= MAX_FILE_BYTES && (f.type === 'application/pdf' || f.type.startsWith('image/')));
    if (!ok) {
      (event.target as HTMLInputElement).value = '';
      this.modalError.set('Please upload valid document (PDF / JPG), less than 2 MB each.');
      this.evidenceEdit.set({ ...e, files: [] });
      return;
    }
    this.modalError.set('');
    this.evidenceEdit.set({ ...e, files });
  }

  protected async saveEvidence(): Promise<void> {
    const e = this.evidenceEdit();
    const d = this.data();
    if (!e || !d) return;
    if (!e.verified) return this.modalError.set('Please select whether the evidence is verified.');
    if (e.verified === 'Yes' && !e.source.trim()) return this.modalError.set('Please enter the source of validation.');
    if (e.verified === 'Yes' && e.files.length === 0) return this.modalError.set('Please upload valid pdf document.');
    if (e.verified === 'No' && !e.remarks.trim()) return this.modalError.set('Please enter remarks.');
    await this.save(
      this.api.validateEvidence(d.zedId, d.certification, e.evidence['Id'], e.verified, e.source.trim(), e.remarks.trim(), e.files),
      () => this.evidenceEdit.set(null),
    );
  }

  protected async setExemption(section: Row, value: 'Yes' | 'No'): Promise<void> {
    const d = this.data();
    if (!d || text(section, 'IsAssessmentExcempted') === value) return;
    this.busy.set(true);
    try {
      const res = await firstValueFrom(this.api.exemption(d.zedId, d.certification, section['Id'], value));
      this.notice.set({ ok: true, text: res.message });
      await this.reload();
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
      await this.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async openFinalSubmit(): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.busy.set(true);
    try {
      const check = await firstValueFrom(this.api.checkFinalSubmit(d.zedId, d.certification));
      if (!check.allowed) {
        this.notice.set({ ok: false, text: check.message ?? 'Please complete the assessment before final submit.' });
        return;
      }
      this.modalError.set('');
      this.finalSubmitEdit.set({ check, remarks: '', confirmed: false });
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async finalSubmit(): Promise<void> {
    const e = this.finalSubmitEdit();
    const d = this.data();
    if (!e || !d || !e.confirmed) return;
    if (!e.remarks.trim()) return this.modalError.set('Please enter assessor final remarks.');
    await this.save(this.api.finalSubmit(d.zedId, d.certification, e.remarks.trim()), () => this.finalSubmitEdit.set(null));
  }

  /** Rows of the round being submitted, for the NC summary of the final-submit pop-up. */
  protected submitRound(): { photos: Row[]; products: Row[]; sections: Row[]; requirements: Row[]; options: Row[]; subOptions: Row[] } {
    const d = this.data();
    const n = this.currentRound();
    if (!d) return { photos: [], products: [], sections: [], requirements: [], options: [], subOptions: [] };
    if (n === 0) return { photos: this.siteExterior(), products: d.products, sections: d.sections, requirements: d.requirements, options: d.options, subOptions: d.subOptions };
    const r = this.round(n);
    return {
      photos: this.roundPhotos(n),
      products: r?.products ?? [],
      sections: r?.sections ?? [],
      requirements: r?.requirements ?? [],
      options: r?.options ?? [],
      subOptions: r?.subOptions ?? [],
    };
  }

  protected refresh(): void {
    void this.reload();
  }

  // ------------------------------------------------------------------ agency review

  /** Opens the "Agency Remarks" pop-up for an assessor finding (product, requirement or site exterior photo). */
  protected editRemarks(kind: RemarksKind, row: Row | undefined): void {
    if (!row || !this.review().editRemarks) return;
    this.remarksTarget.set({ kind, id: row['Id'], remarks: text(row, 'AssessorRemarks') });
  }

  protected async reviewed(message: string): Promise<void> {
    this.remarksTarget.set(null);
    this.notice.set({ ok: true, text: message });
    await this.reload();
  }

  // ------------------------------------------------------------------ plumbing

  private validation(e: ValidationEdit): boolean {
    if (!e.verified) {
      this.modalError.set('This is required.');
      return false;
    }
    if (e.verified === 'No' && !e.remarks.trim()) {
      this.modalError.set('Please enter remarks.');
      return false;
    }
    return true;
  }

  private async save(call: Observable<{ message: string }>, close: () => void): Promise<void> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(call);
      close();
      this.notice.set({ ok: true, text: 'Data Updated' });
      await this.reload();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private reload(): Promise<void> {
    return this.load(this.zedId(), this.level(), false);
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
      if (first) this.tab.set(1);
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
