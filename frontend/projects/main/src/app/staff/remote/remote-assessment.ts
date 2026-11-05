import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom, tap } from 'rxjs';
import { withApiBase } from '../../api-base';
import { ContentService, ContentTextComponent, fillText, textParts } from '../../content/content-text';
import { DETAILS_STYLES, num, text } from '../assessment/assessment-shared';
import { AssessmentApi, OpenedType } from '../assessment/assessment.api';
import { CHECKPOINT_CHIP_STYLES, Checkpoint, CheckpointDialog, CheckpointSaveRequest, CheckpointValue, checkpointsOf } from '../assessment/checkpoint-dialog';
import { SaNcProduct, SaNcRound, SiteReviewApi } from '../site-review/site-review.api';
import { FinalSubmitCheck, MAX_RECORDING_LINKS, Meeting, PhotoTarget, RemoteApi, RemoteDetails, RemotePhoto, Row } from './remote.api';

const NUMBERS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A certificate validity in words, as the certificate words it: 36 → "three years", 12 → "one year", 18 → "18 months". */
export function validityText(months: number): string {
  if (months > 0 && months % 12 === 0) {
    const years = months / 12;
    return `${NUMBERS[years] ?? years} year${years === 1 ? '' : 's'}`;
  }
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** A level's number of surveillances in words, as the instructions word it: 2 → "Two Surveillance Assessments". */
export function surveillancesText(count: number): string {
  const word = NUMBERS[count] ?? String(count);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} Surveillance Assessment${count === 1 ? '' : 's'}`;
}

/** Google Maps address of a latitude/longitude pair ('' when either is missing or not a number). */
export function mapUrl(lat: unknown, lng: unknown): string {
  const a = Number(lat);
  const b = Number(lng);
  return lat && lng && Number.isFinite(a) && Number.isFinite(b) ? `https://www.google.com/maps?q=${a},${b}` : '';
}

export interface MapLocation { title: string; lat: string; lng: string; href: string }

export type RemoteTab = 'instructions' | 'overview' | 'openMeeting' | 'basicInfo' | 'siteTour' | 'parameters' | 'closeMeeting' | 'nc';

export const TABS: { id: RemoteTab; no: number; title: string }[] = [
  { id: 'overview', no: 1, title: 'Assessment Overview' },
  { id: 'openMeeting', no: 3, title: 'Opening Meeting' },
  { id: 'basicInfo', no: 4, title: 'Basic Info' },
  { id: 'siteTour', no: 2, title: 'Site Tour' },
  { id: 'parameters', no: 5, title: 'Parameters' },
  { id: 'closeMeeting', no: 6, title: 'Closing Meeting' },
];

/** Surveillance (that portal's Remote/Index.cshtml): an Instructions tab first, the site tour as "Assessment Evidence". */
export const SURVEILLANCE_TABS: { id: RemoteTab; no: number; title: string }[] = [
  { id: 'instructions', no: 1, title: 'Instructions' },
  { id: 'overview', no: 2, title: 'Assessment Overview' },
  { id: 'openMeeting', no: 3, title: 'Opening Meeting' },
  { id: 'basicInfo', no: 4, title: 'Basic Info' },
  { id: 'siteTour', no: 5, title: 'Assessment Evidence' },
  { id: 'parameters', no: 6, title: 'Parameters' },
  { id: 'closeMeeting', no: 7, title: 'Closing Meeting' },
];

/** Basic Info rows: DA answer column, remote answer column, Yes/No choice. */
export const BASIC_INFO: { label: string; da: string; sa: string; yesNo: boolean }[] = [
  { label: 'Whether 3rd Party Financial Audits are conducted?', da: 'AuditsConducted', sa: 'SaAuditsConducted', yesNo: true },
  { label: 'Key Domestic Customers', da: 'DomesticCustomers', sa: 'SaDomesticCustomers', yesNo: false },
  { label: 'Key International Customers', da: 'InternationalCustomers', sa: 'SaInternationalCustomers', yesNo: false },
  { label: 'Processed Outsourced, if any?', da: 'OutsourcedProcesses', sa: 'SaOutsourcedProcesses', yesNo: false },
  { label: 'Energy Source(s) Used', da: 'EnergySources', sa: 'SaEnergySources', yesNo: false },
  { label: 'Manufacturing Capacity Units', da: 'ManufacturingCapacityUnits', sa: 'SaManufacturingCapacityUnits', yesNo: false },
  { label: 'Manufacturing Capacity Value', da: 'ManufacturingCapacityValue', sa: 'SaManufacturingCapacityValue', yesNo: false },
  { label: 'Monthly Utilization Units', da: 'MonthlyUtilizationUnits', sa: 'SaMonthlyUtilizationUnits', yesNo: false },
  { label: 'Monthly Utilization Value', da: 'MonthlyUtilizationValue', sa: 'SaMonthlyUtilizationValue', yesNo: false },
];

interface Capture { target: PhotoTarget; targetId: number | null; image: string; name: string; fixedName: boolean }
interface Choice { kind: 'conformance' | 'product' | 'siteExterior'; id: number | null; title: string; value: string; remarks: string; max: number }
interface TextEdit { kind: 'basicInfo' | 'ofi' | 'meeting'; id: number | null; column: string; title: string; value: string; yesNo: boolean }
interface FinalSubmitEdit { check: FinalSubmitCheck; comments: string; confirmed: boolean }

/**
 * The site assessor's remote assessment of a unit. Port of Views/Remote/Index.cshtml: unit
 * overview, opening/closing meeting (participants, comments, photo), basic info answers, site tour photos,
 * parameter conformance with evidence photos, product and site exterior validation and final submit.
 * There is no video call on this page (the old Twilio "Start Assessment" was removed): photos are JPEG files the
 * assessor uploads. Tabs and pop-ups are signal-controlled markup; nothing from the server is rendered as HTML.
 * Surveillance (the API sends usesMeetingLink): the Overview tab shows the surveillance dates,
 * the assessor, "Click here to Join" (the agency's meeting link, in a new tab) and the site/surveillance locations; the header
 * has Refresh and ASSESSMENT REPORT;
 * the opening/closing meeting photos and the assessor's selfie are uploaded JPEG files, the closing meeting takes up
 * to 6 recording links, and parameter evidence comes from the site tour photos of the app; the page opens on that
 * portal's Instructions tab and calls the site tour "Assessment Evidence".
 * NC rounds (the old SaDetails page's NC tabs): at status 14 the page opens on an "NC n" tab with the MSME's answers to the
 * round (from the site details, SiteReviewApi); once they are submitted the lead assessor answers the round's products,
 * site exterior photos and requirements (checkpoints where the requirement has them) and final-submits. The other tabs are
 * then read-only.
 */
@Component({
  selector: 'zed-staff-remote-assessment',
  imports: [FormsModule, RouterLink, ContentTextComponent, CheckpointDialog],
  templateUrl: './remote-assessment.html',
  styles: [DETAILS_STYLES, CHECKPOINT_CHIP_STYLES],
  styleUrl: './remote-assessment.css',
  host: { '(document:keydown.escape)': 'preview.set(null)' },
})
export class RemoteAssessmentPage {
  private readonly api = inject(RemoteApi);
  private readonly siteReview = inject(SiteReviewApi);
  private readonly content = inject(ContentService);
  private readonly assessmentApi = inject(AssessmentApi);
  private readonly params = inject(ActivatedRoute).snapshot.paramMap;
  protected readonly zedId = this.params.get('zedId') ?? '';
  protected readonly certification = this.params.get('certification') ?? '';

  protected readonly t = text;
  protected readonly n = num;
  /** The Instructions tab of the surveillance page (Admin → Texts): one row per item. */
  protected readonly instructions = computed(() => {
    const t = this.content.text('staff.surveillance.remote.instructions');
    // {{Validity}} and {{SurveillanceAssessments}}: the unit's level settings (Administration → Certification Levels).
    const d = this.data();
    return t?.enabled
      ? textParts(fillText(t.html, {
        Validity: validityText(d?.validityMonths ?? 36),
        SurveillanceAssessments: surveillancesText(d?.surveillanceCount ?? 2),
      }), 'li')
      : [];
  });
  protected readonly basicInfo = BASIC_INFO;

  protected readonly data = signal<RemoteDetails | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly modalError = signal('');
  protected readonly tab = signal<RemoteTab>('overview');
  protected readonly preview = signal<string | null>(null);

  protected readonly capture = signal<Capture | null>(null);
  protected readonly choice = signal<Choice | null>(null);
  protected readonly checkpointEdit = signal<{ id: number; checkpoints: Checkpoint[]; title: string } | null>(null);
  protected readonly textEdit = signal<TextEdit | null>(null);
  protected readonly fromTourFor = signal<number | null>(null);
  protected readonly finalSubmit = signal<FinalSubmitEdit | null>(null);
  protected participant: Record<string, { name: string; designation: string }> = {
    open: { name: '', designation: '' },
    close: { name: '', designation: '' },
  };

  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  /** The open NC round (status 14), if any. */
  protected readonly nc = computed(() => this.data()?.nc ?? null);
  /** The NC round's rows (products, site exterior photos, requirements with the MSME's answers). */
  protected readonly ncRound = signal<SaNcRound | null>(null);
  /** The first assessment's tabs: read-only during an NC round. */
  protected readonly canAssess = computed(() => (this.data()?.permissions.canAssess ?? false) && !this.nc());
  /** The NC tab: the lead assessor, once the MSME has submitted the round. */
  protected readonly canAssessNc = computed(() => (this.data()?.permissions.canAssess ?? false) && !!this.nc()?.submitted);
  /** Surveillance: held on the agency's meeting link. */
  protected readonly meetingMode = computed(() => this.data()?.usesMeetingLink === true);
  protected readonly maxRecordingLinks = MAX_RECORDING_LINKS;
  protected recordingLink = '';
  protected readonly tabs = computed(() => {
    const base = this.meetingMode() ? SURVEILLANCE_TABS : TABS;
    const nc = this.nc();
    return nc ? [...base, { id: 'nc' as RemoteTab, no: base.length + 1, title: `NC ${nc.round}` }] : base;
  });
  protected readonly currentTab = computed(() => this.tabs().find((x) => x.id === this.tab()) ?? this.tabs()[0]);
  protected readonly daSelfies = computed(() => (this.data()?.daPhotos ?? []).filter((p) => text(p, 'PhotoType') === 'Selfie'));
  protected readonly daSiteExterior = computed(() => (this.data()?.daPhotos ?? []).filter((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos'));
  protected readonly mapUrl = computed(() => mapUrl(this.data()?.location?.['Latitude'], this.data()?.location?.['Longitude']));
  /**
   * Surveillance Overview (that portal's Remote/Index.cshtml): the site assessment's location (ZedSaLatitude/ZedSaLongitude)
   * and, once the assessor recorded one, the surveillance assessment's (SurLatitude/SurLongitude).
   */
  protected readonly locations = computed<MapLocation[]>(() => {
    const rows = [this.data()?.location ?? {}, this.msme()];
    const value = (column: string) => rows.map((r) => text(r, column)).find((v) => v) ?? '';
    const box = (title: string, lat: string, lng: string): MapLocation => ({ title, lat: value(lat), lng: value(lng), href: mapUrl(value(lat), value(lng)) });
    const site = box('Site Assessment', 'ZedSaLatitude', 'ZedSaLongitude');
    const surveillance = box('Surveillance Assessment', 'SurLatitude', 'SurLongitude');
    return surveillance.lat ? [site, surveillance] : [site];
  });
  /** "ASSESSMENT REPORT" (the old SA/ReportSummary/{ZedId}?Certification=…), served by the certification documents API. */
  protected readonly reportUrl = computed(() =>
    withApiBase(`/api/staff/certification-documents/${encodeURIComponent(this.zedId)}/${encodeURIComponent(this.data()?.certification ?? this.certification)}/report`));
  /** Product descriptions opened on this page (the old page marked them opened without a reload). */
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  /** Products and parameters marked "No" (shown in the final-submit pop-up); in an NC round, the round's. */
  protected readonly ncProducts = computed(() => (this.nc() ? [] : (this.data()?.products ?? []).filter((p) => text(p, 'IsSaVerified') === 'No')));
  protected readonly ncRequirements = computed(() =>
    (this.nc() ? (this.ncRound()?.requirements ?? []) : (this.data()?.requirements ?? [])).filter((r) => text(r, 'SaConformance') === 'No'));
  protected readonly ncRoundProducts = computed(() => (this.ncRound()?.products ?? []).filter((p) => p.isSaVerified === 'No'));

  constructor() {
    void this.load();
  }

  // ------------------------------------------------------------------ data

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const first = this.data() === null;
      const details = await firstValueFrom(this.api.details(this.zedId, this.certification));
      // The NC round's rows (with the MSME's answers and their files) are those of the site details page.
      const round = details.nc
        ? ((await firstValueFrom(this.siteReview.details(this.zedId, this.certification))).ncRounds ?? []).find((r) => r.ncCount === details.nc!.round) ?? null
        : null;
      this.data.set(details);
      this.ncRound.set(round);
      if (first && this.meetingMode()) this.tab.set('instructions');
      if (first && details.nc) this.tab.set('nc');
      this.error.set('');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected refresh(): void {
    this.notice.set(null);
    void this.load();
  }

  /** Runs a change, closes the pop-up and reloads; errors stay in the pop-up (or the page when none is open). */
  private async run(call: Observable<unknown>, close: () => void, inModal = true): Promise<boolean> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(call);
      close();
      await this.load();
      return true;
    } catch (err) {
      if (inModal) this.modalError.set(apiErrorMessage(err));
      else this.notice.set({ ok: false, text: apiErrorMessage(err) });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ view helpers

  protected requirementsOf(section: Row): Row[] {
    return (this.data()?.requirements ?? []).filter((r) => text(r, 'SectionCode') === text(section, 'SectionCode'));
  }

  protected optionsOf(r: Row): Row[] {
    return (this.data()?.options ?? []).filter((o) => text(o, 'SectionCode') === text(r, 'SectionCode') && text(o, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected subOptionsOf(o: Row): Row[] {
    return (this.data()?.subOptions ?? []).filter(
      (s) => text(s, 'SectionCode') === text(o, 'SectionCode') && text(s, 'RequirementCode') === text(o, 'RequirementCode') && text(s, 'OptionCode') === text(o, 'OptionCode'),
    );
  }

  protected evidencesOf(r: Row): Row[] {
    return (this.data()?.evidences ?? []).filter((e) => text(e, 'SectionCode') === text(r, 'SectionCode') && text(e, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected photosOf(row: Row): RemotePhoto[] {
    return (row['RemotePhotos'] as RemotePhoto[] | undefined) ?? [];
  }

  protected productPhotos(p: Row, name: string): RemotePhoto[] {
    return this.photosOf(p).filter((x) => x.name === name);
  }

  protected exempted(section: Row): boolean {
    return text(section, 'IsAssessmentExcempted') === 'Yes';
  }

  protected id(row: Row): number {
    return num(row, 'Id');
  }

  protected section(r: Row): Row | undefined {
    return (this.data()?.sections ?? []).find((s) => text(s, 'SectionCode') === text(r, 'SectionCode'));
  }

  // ------------------------------------------------------------------ NC round

  private static same(a: Row, b: Row, ...columns: string[]): boolean {
    return columns.every((c) => text(a, c).trim() === text(b, c).trim());
  }

  protected ncRequirementsOf(section: Row): Row[] {
    return (this.ncRound()?.requirements ?? []).filter((r) => RemoteAssessmentPage.same(r, section, 'SectionCode'));
  }

  protected ncOptionsOf(r: Row): Row[] {
    return (this.ncRound()?.options ?? []).filter((o) => RemoteAssessmentPage.same(o, r, 'SectionCode', 'RequirementCode'));
  }

  protected ncSubOptionsOf(o: Row): Row[] {
    return (this.ncRound()?.subOptions ?? []).filter((s) => RemoteAssessmentPage.same(s, o, 'SectionCode', 'RequirementCode', 'OptionCode'));
  }

  protected ncEvidencesOf(r: Row): Row[] {
    return (this.ncRound()?.evidences ?? []).filter((e) => RemoteAssessmentPage.same(e, r, 'SectionCode', 'RequirementCode'));
  }

  /** The checkpoint answers of an NC requirement row: the site assessor's of this round. */
  protected ncCheckpointCounts(r: Row): { yes: number; partial: number; no: number; total: number } {
    const all = checkpointsOf(this.data()?.checkpoints, r['Id']);
    const count = (v: string) => all.filter((c) => c.site?.value === v).length;
    return { yes: count('Yes'), partial: count('Partial'), no: count('No'), total: all.length };
  }

  protected openNcProduct(p: SaNcProduct): void {
    this.modalError.set('');
    this.choice.set({ kind: 'product', id: p.id, title: p.productName ?? 'Product', value: p.isSaVerified ?? '', remarks: p.saAssessorRemarks ?? '', max: 1000 });
  }

  protected openNcSiteExterior(): void {
    this.modalError.set('');
    const first = this.ncRound()?.photos?.[0];
    this.choice.set({ kind: 'siteExterior', id: null, title: 'Site Exterior Photos', value: first?.isVerified ?? '', remarks: first?.assessorRemarks ?? '', max: 1000 });
  }

  /** The product description PDF was opened (ProductDescOpenedTime, or on this page): the icon turns blue. */
  protected descriptionOpened(p: Row): boolean {
    return !!text(p, 'ProductDescOpenedTime') || this.opened().has('ProductDescriptionPhoto:' + text(p, 'Id'));
  }

  /** Records that the assessor opened a document (the old Assessment/SaveTimestamp, as the desktop assessment page does). */
  protected markOpened(type: OpenedType, row: Row): void {
    if (!this.canAssess()) return;
    const key = type + ':' + text(row, 'Id');
    if (this.opened().has(key)) return;
    this.opened.update((s) => new Set(s).add(key));
    firstValueFrom(this.assessmentApi.opened(this.zedId, this.data()?.certification ?? this.certification, type, row['Id'])).catch((err) => {
      this.opened.update((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    });
  }

  // ------------------------------------------------------------------ photos

  /** Main: a JPEG chosen by the assessor, shown in the photo pop-up to be named (where the name is free) and saved. */
  protected async pickPhoto(target: PhotoTarget, targetId: number | null, defaultName: string, fixedName: boolean, input: HTMLInputElement): Promise<void> {
    this.notice.set(null);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!isJpegUpTo5Mb(file)) {
      this.notice.set({ ok: false, text: 'Please upload a JPEG photo of at most 5 MB.' });
      return;
    }
    this.modalError.set('');
    this.capture.set({ target, targetId, image: await readAsDataUrl(file), name: defaultName, fixedName });
  }

  protected async saveCapture(): Promise<void> {
    const c = this.capture();
    if (!c) return;
    if (!c.name.trim()) {
      this.modalError.set('Please enter Photo Name.');
      return;
    }
    await this.run(
      this.api.savePhoto(this.zedId, this.certification, { target: c.target, targetId: c.targetId, name: c.fixedName ? null : c.name.trim(), image: c.image }),
      () => this.capture.set(null),
    );
  }

  /** Surveillance: uploads a JPEG chosen by the assessor (opening/closing meeting photo or "Selfie on Site"). */
  protected async uploadPhoto(target: PhotoTarget, targetId: number | null, input: HTMLInputElement): Promise<void> {
    this.notice.set(null);
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!isJpegUpTo5Mb(file)) {
      this.notice.set({ ok: false, text: 'Please upload a JPEG photo of at most 5 MB.' });
      return;
    }
    const image = await readAsDataUrl(file);
    await this.run(this.api.savePhoto(this.zedId, this.certification, { target, targetId, image }), () => undefined, false);
  }

  /** Surveillance: adds a recording link of the closing meeting. */
  protected async addRecordingLink(meeting: Meeting): Promise<void> {
    const link = this.recordingLink.trim();
    if (!/^https?:\/\/\S+$/i.test(link)) {
      this.notice.set({ ok: false, text: 'Please enter a valid recording link (starting with https:// or http://).' });
      return;
    }
    const ok = await this.run(this.api.addRecordingLink(this.zedId, this.certification, meeting.id, link), () => undefined, false);
    if (ok) this.recordingLink = '';
  }

  protected async useTourPhoto(photo: RemotePhoto): Promise<void> {
    const requirementId = this.fromTourFor();
    if (requirementId === null) return;
    await this.run(
      this.api.savePhoto(this.zedId, this.certification, { target: 'Requirement', targetId: requirementId, fromPhotoId: photo.id }),
      () => this.fromTourFor.set(null),
    );
  }

  protected async removePhoto(photo: RemotePhoto): Promise<void> {
    if (!window.confirm('Remove this photo?')) return;
    await this.run(this.api.deletePhoto(this.zedId, this.certification, photo.id), () => undefined, false);
  }

  // ------------------------------------------------------------------ pop-ups

  protected openConformance(r: Row): void {
    this.modalError.set('');
    // A requirement with checkpoints (migration 0039) is answered checkpoint by checkpoint; its site conformance follows.
    const checkpoints = checkpointsOf(this.data()?.checkpoints, r['Id']);
    if (checkpoints.length) {
      this.checkpointEdit.set({ id: this.id(r), checkpoints, title: `${text(r, 'SectionCode')}.${text(r, 'RequirementCode')}` });
      return;
    }
    this.choice.set({ kind: 'conformance', id: this.id(r), title: 'Conformance', value: text(r, 'SaConformance'), remarks: text(r, 'SaAssessorRemarks'), max: 2000 });
  }

  protected async saveCheckpoints(body: CheckpointSaveRequest): Promise<void> {
    const e = this.checkpointEdit();
    if (!e) return;
    await this.run(this.api.checkpoints(this.zedId, this.certification, e.id, body), () => this.checkpointEdit.set(null));
  }

  /** The answers of a checkpoint (an option row of a requirement row): the desktop assessor's and the site assessor's. */
  protected answersOf(r: Row, o: Row): { desktop: CheckpointValue | null; site: CheckpointValue | null } {
    const c = checkpointsOf(this.data()?.checkpoints, r['Id']).find((x) => x.optionCode === text(o, 'OptionCode').trim());
    return { desktop: c?.desktop?.value ?? null, site: c?.site?.value ?? null };
  }

  protected openProduct(p: Row): void {
    this.modalError.set('');
    this.choice.set({ kind: 'product', id: this.id(p), title: text(p, 'ProductName'), value: text(p, 'IsSaVerified'), remarks: text(p, 'SaAssessorRemarks'), max: 1000 });
  }

  protected openSiteExterior(): void {
    this.modalError.set('');
    const m = this.msme();
    this.choice.set({ kind: 'siteExterior', id: null, title: 'Site Exterior Photos', value: text(m, 'IsSaVerified'), remarks: text(m, 'SaAssessorRemarks'), max: 1000 });
  }

  protected async saveChoice(): Promise<void> {
    const c = this.choice();
    if (!c) return;
    if (c.value !== 'Yes' && c.value !== 'No') {
      this.modalError.set('This is required.');
      return;
    }
    if (c.value === 'No' && !c.remarks.trim()) {
      this.modalError.set('Please enter remarks.');
      return;
    }
    const call =
      c.kind === 'conformance'
        ? this.api.conformance(this.zedId, this.certification, c.id!, c.value, c.remarks)
        : c.kind === 'product'
          ? this.api.validateProduct(this.zedId, this.certification, c.id!, c.value, c.remarks)
          : this.api.validateSiteExterior(this.zedId, this.certification, c.value, c.remarks);
    await this.run(call, () => this.choice.set(null));
  }

  protected openBasicInfo(row: (typeof BASIC_INFO)[number]): void {
    this.modalError.set('');
    this.textEdit.set({ kind: 'basicInfo', id: null, column: row.sa, title: row.label, value: text(this.msme(), row.sa), yesNo: row.yesNo });
  }

  protected openOfi(section: Row): void {
    this.modalError.set('');
    this.textEdit.set({ kind: 'ofi', id: this.id(section), column: '', title: 'OFI Comments', value: text(section, 'OfiComments'), yesNo: false });
  }

  protected openMeetingComments(meeting: Meeting): void {
    this.modalError.set('');
    this.textEdit.set({ kind: 'meeting', id: meeting.id, column: '', title: 'Meeting Comments', value: meeting.comments ?? '', yesNo: false });
  }

  protected async saveText(): Promise<void> {
    const e = this.textEdit();
    if (!e) return;
    if (!e.value.trim()) {
      this.modalError.set('This is required.');
      return;
    }
    const call =
      e.kind === 'basicInfo'
        ? this.api.basicInfo(this.zedId, this.certification, e.column, e.value)
        : e.kind === 'ofi'
          ? this.api.ofiComments(this.zedId, this.certification, e.id!, e.value)
          : this.api.meetingComments(this.zedId, this.certification, e.id!, e.value);
    await this.run(call, () => this.textEdit.set(null));
  }

  protected async addParticipant(meeting: Meeting, key: 'open' | 'close'): Promise<void> {
    const p = this.participant[key];
    if (!p.name.trim() || !p.designation.trim()) {
      this.notice.set({ ok: false, text: "Please enter the participant's name and designation." });
      return;
    }
    const ok = await this.run(this.api.addParticipant(this.zedId, this.certification, meeting.id, p.name.trim(), p.designation.trim()), () => undefined, false);
    if (ok) this.participant[key] = { name: '', designation: '' };
  }

  protected async openFinalSubmit(): Promise<void> {
    this.notice.set(null);
    this.busy.set(true);
    try {
      const check = await firstValueFrom(this.api.checkFinalSubmit(this.zedId, this.certification));
      if (!check.allowed) {
        this.notice.set({ ok: false, text: check.message ?? 'Please complete the assessment before final submit.' });
        return;
      }
      this.modalError.set('');
      this.finalSubmit.set({ check, comments: '', confirmed: false });
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const f = this.finalSubmit();
    if (!f || !f.confirmed) return;
    if (!f.comments.trim()) {
      this.modalError.set('Please enter comments.');
      return;
    }
    let message = 'Assessment submitted.';
    const ok = await this.run(
      this.api.finalSubmit(this.zedId, this.certification, f.comments.trim()).pipe(tap((r) => (message = r.message || message))),
      () => this.finalSubmit.set(null),
    );
    if (ok) {
      // A submitted onsite unit (closed, NC round sent to the MSME or to the agency) is no longer open here: the reload
      // answers 404, so the page keeps only the outcome and the way back to the list.
      if (this.error()) {
        this.error.set('');
        this.data.set(null);
        this.ncRound.set(null);
      }
      this.notice.set({ ok: true, text: message });
    }
  }
}

/** The photos the API keeps (RemoteFiles.MaxPhotoBytes). */
function isJpegUpTo5Mb(file: File): boolean {
  return /^image\/jpe?g$/i.test(file.type) && file.size <= 5 * 1024 * 1024;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
