import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { ReviewActionsBar, ReviewRemarksDialog, RemarksTarget } from '../monitoring/review-actions';
import { NO_REVIEW, RemarksKind } from '../monitoring/review.api';
import { AppFormValuesPanel } from './app-form-values';
import { CHECKPOINT_CHIP_STYLES, Checkpoint, CheckpointDialog, CheckpointSaveRequest, CheckpointValue, checkpointsOf } from './checkpoint-dialog';
import { ASSESSMENT_SYSTEM, DETAILS_STYLES, flag, num, text } from './assessment-shared';
import { AssessmentApi, DaDetails, FinalSubmitCheck, NcRound, OpenedType, Row, canonicalLevel, isZedId } from './assessment.api';
import { RequirementVideo } from '../../msme/shared/requirement-video';
import { ThreadMessage, hasContent, message } from '../../msme/shared/nc-thread';
import { ParameterChip, ParameterNav, ParameterProgress, ParameterStatus, parameterChip, parameterComplete, parameterProgress, parameterStatus, requirementStatus } from '../../msme/shared/parameter-status';

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

/** Surveillance's DaDetails.cshtml numbers the tabs in their order: ESG 3, parameters 4, NC n at n + 4. */
const SURVEILLANCE_TAB_NUMBERS: Record<number, number> = { 1: 1, 2: 2, 9: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9 };

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5;

interface ConformanceEdit { requirement: Row; conformance: string; remarks: string }
interface ValidationEdit { row: Row | null; verified: string; remarks: string }
interface EvidenceEdit { evidence: Row; verified: string; source: string; remarks: string; files: File[] }
interface FinalSubmitEdit { check: FinalSubmitCheck; remarks: string; confirmed: boolean }

/** A key fact of the assessment summary card (label above, value below; wide facts span two columns). */
export interface SummaryFact { label: string; value: string; wide?: boolean }


/**
 * Desktop assessment review page. Port of Views/Assessment/DaDetails.cshtml for the desktop assessor
 * (validate photos, products, evidences and conformance, exemptions, final submit) and read-only for
 * the other roles of the old page, with the agency / master-admin review actions (edit remarks, final
 * submit, send back, reject: the old Monitoring actions) where the server allows them (`permissions.review`).
 * Bootstrap tabs and modals are signal-controlled markup.
 */
@Component({
  selector: 'zed-staff-da-details',
  imports: [FormsModule, RouterLink, ReviewActionsBar, ReviewRemarksDialog, ContentTextComponent, AppFormValuesPanel, CheckpointDialog, RequirementVideo],
  templateUrl: './da-details.html',
  styles: [DETAILS_STYLES, CHECKPOINT_CHIP_STYLES],
  styleUrl: './da-details.css',
  host: { '(document:keydown.escape)': 'preview.set(null)' },
})
export class DaDetailsPage {
  /** Route parameters. */
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();

  private readonly api = inject(AssessmentApi);
  /** Surveillance build: the ESG tab as on that portal's page (S.No column, black panel headings, tab numbers). */
  protected readonly surveillanceSystem = inject(ASSESSMENT_SYSTEM) === 'surveillance';
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly n = num;
  protected readonly tabTitles = TAB_TITLES;
  protected readonly tabNumber = (id: number) => (this.surveillanceSystem ? SURVEILLANCE_TAB_NUMBERS[id] ?? id : id);

  protected readonly data = signal<DaDetails | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly tab = signal(1);
  /** Parameter (section Id) shown in the parameters tab; the first one when none is picked. */
  protected readonly selectedSection = signal<string | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly modalError = signal('');

  protected readonly conformanceEdit = signal<ConformanceEdit | null>(null);
  protected readonly checkpointEdit = signal<{ requirement: Row; checkpoints: Checkpoint[]; title: string } | null>(null);
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

  /** Surveillance: answers from the Bronze surveillance app and the location of the original ZED assessment. */
  protected readonly surveillance = computed(() => this.data()?.surveillance ?? null);
  protected readonly zedMapUrl = computed(() => {
    const l = this.surveillance()?.zedLocation;
    const lat = Number(l?.['ZedLatitude']);
    const lng = Number(l?.['ZedLongitude']);
    return Number.isFinite(lat) && Number.isFinite(lng) && l?.['ZedLatitude'] ? `https://www.google.com/maps?q=${lat},${lng}` : '';
  });

  /** The key facts of the "Assessment Summary" card, in the order of the old two-column table. */
  protected readonly summaryFacts = computed<SummaryFact[]>(() => {
    const m = this.msme();
    const v = (column: string) => text(m, column);
    const pair = (a: string, b: string) => [v(a), v(b)].filter(Boolean).join(' - ');
    const facts: SummaryFact[] = [
      { label: 'ZED ID', value: v('ZedId') },
      { label: 'Unit Name', value: v('PUnitName') },
      { label: 'Udyam Registration Number', value: v('UdyogAadharNo') },
      { label: 'Unit Address', value: v('PlantAddress'), wide: true },
      { label: 'Document Submission Date', value: v('BasicInfoStatus') },
      { label: 'Document Verification allocated on', value: v('DocVerifiAllot') },
    ];
    for (const i of [1, 2, 3, 4, 5]) {
      if (v(`Nc${i}Raised`)) facts.push({ label: `Non-Conformance ${i} Raised On`, value: v(`Nc${i}Raised`) });
      if (v(`Nc${i}Submitted`)) facts.push({ label: `Non-Conformance ${i} Submitted On`, value: v(`Nc${i}Submitted`) });
    }
    facts.push({ label: 'Document Verification Completed on', value: v('CompletedOn') }, { label: 'Certification', value: v('Certification') });
    if (!this.isQc()) {
      facts.push(
        { label: 'Agency Name', value: pair('CertificationBodyUserId', 'AgencyName') },
        { label: 'Desktop Assessor Name', value: pair('DesktopAssessorId', 'DesktopAssessorName') },
      );
    }
    return facts;
  });

  /** The parameter shown in the parameters tab. */
  protected readonly activeSection = computed<Row | null>(() => {
    const sections = this.data()?.sections ?? [];
    const id = this.selectedSection();
    return sections.find((s) => text(s, 'Id') === id) ?? sections[0] ?? null;
  });

  /** NC tab shown (tabs 4..8 are NC1..NC5), 0 elsewhere. */
  protected readonly ncRoundNumber = computed(() => (this.tab() >= 4 && this.tab() <= 8 ? this.tab() - 3 : 0));
  /** Parameters of the NC round shown that have requirements in that round. */
  protected readonly ncSections = computed(() => {
    const rd = this.round(this.ncRoundNumber());
    return (rd?.sections ?? []).filter((s) => this.requirementsOf(s, rd?.requirements).length > 0);
  });
  /** NC tabs: the round's parameter list (status from the round's conformance) and the selected parameter. */
  protected readonly rn = new ParameterNav<Row, Row>({
    sections: () => this.ncSections(),
    id: (s) => text(s, 'Id'),
    requirements: (s) => this.requirementsOf(s, this.round(this.ncRoundNumber())?.requirements),
    conformance: (r) => r['Conformance'],
    answered: (r) => checkpointsOf(this.data()?.checkpoints, r['Id']).some((c) => c.desktop?.value),
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

  /**
   * Status of a requirement row: its conformance when given; "Partial" while only some of its checkpoints are answered
   * (or one is answered Partial); "Pending" when nothing is answered yet.
   */
  protected requirementStatus(r: Row): ParameterStatus {
    return requirementStatus(text(r, 'Conformance'), checkpointsOf(this.data()?.checkpoints, r['Id']).some((c) => c.desktop?.value));
  }

  /** Status of a parameter from its requirements: all Yes, any No, some answered (Partial) or nothing answered (Pending). */
  protected sectionStatus(s: Row): ParameterStatus {
    return parameterStatus(this.requirementsOf(s, this.data()?.requirements).map((r) => this.requirementStatus(r)));
  }

  protected exempted(s: Row): boolean {
    return text(s, 'IsAssessmentExcempted') === 'Yes';
  }

  /** Requirements of a parameter with a conformance given (done) out of all its requirements. */
  protected sectionProgress(s: Row): ParameterProgress {
    return parameterProgress(this.requirementsOf(s, this.data()?.requirements).map((r) => r['Conformance']));
  }

  /** Chip of a parameter in the list: "Exempt" for an exempted parameter, else its status. */
  protected navStatus(s: Row): ParameterChip {
    return parameterChip(this.sectionStatus(s), this.exempted(s));
  }

  /** Parameters complete (every requirement decided: status Yes or No; exempted ones count as complete). */
  protected readonly completeCount = computed(() => (this.data()?.sections ?? []).filter((s) => parameterComplete(this.sectionProgress(s), this.exempted(s))).length);

  protected selectSection(s: Row): void {
    this.selectedSection.set(text(s, 'Id'));
  }

  /** Responses of the round being shown (NcCount = the round) for a requirement: its conformance and remarks are answered there. */
  protected currentRoundEvidences(r: Row, rd: NcRound | undefined, nc: number): Row[] {
    return this.evidencesOf(r, rd?.evidences).filter((e) => num(e, 'NcCount') === nc);
  }

  /**
   * NC tabs: the requirement's conversation up to round `nc`, oldest first: the desktop assessor's remark that raised NC1
   * (with the documents it was raised on), then per round the unit's reply (comments, files) and the assessor's verdict.
   */
  protected ncThread(r: Row, rd: NcRound | undefined, nc: number): ThreadMessage[] {
    const d = this.data();
    if (!d) return [];
    const same = (x: Row) => text(x, 'SectionCode') === text(r, 'SectionCode') && text(x, 'RequirementCode') === text(r, 'RequirementCode');
    const desk = d.requirements.find(same);
    const out: ThreadMessage[] = [
      message('assessor', 'NC1 raised', {
        text: text(desk, 'AssessorRemarks'),
        conformance: text(desk, 'Conformance'),
        all: this.evidencesOf(r, d.evidences).map((e) => ({ name: text(e, 'EvidenceName'), url: text(e, 'FileUrl'), opened: true })),
      }),
    ];
    const rows = this.evidencesOf(r, rd?.evidences);
    const rounds = [...new Set(rows.map((e) => num(e, 'NcCount')))].filter((k) => k > 0 && k <= nc).sort((a, b) => a - b);
    for (const k of rounds) {
      const group = rows.filter((e) => num(e, 'NcCount') === k);
      const first = (column: string) => group.map((e) => text(e, column)).find(Boolean) ?? '';
      out.push(message('msme', `NC${k}`, {
        date: first('SyncedDate'),
        text: first('RequirementMsmeRemarks'),
        all: group.map((e) => ({ name: text(e, 'EvidenceName'), url: text(e, 'FileUrl'), opened: flag(e, 'Opened'), row: e })),
      }));
      const current = k === nc;
      out.push(message('assessor', `NC${k}`, {
        text: (current && text(r, 'AssessorRemarks')) || first('RequirementRemarks'),
        conformance: (current && text(r, 'Conformance')) || first('Conformance'),
      }));
    }
    if (!rounds.includes(nc) && text(r, 'Conformance')) {
      out.push(message('assessor', `NC${nc}`, { text: text(r, 'AssessorRemarks'), conformance: text(r, 'Conformance') }));
    }
    return out.filter(hasContent);
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
    // A requirement with checkpoints (migration 0039) is answered checkpoint by checkpoint; its conformance follows.
    const checkpoints = checkpointsOf(this.data()?.checkpoints, r['Id']);
    if (checkpoints.length) {
      this.checkpointEdit.set({ requirement: r, checkpoints, title: `${text(r, 'SectionCode')}.${text(r, 'RequirementCode')}` });
      return;
    }
    this.conformanceEdit.set({ requirement: r, conformance: text(r, 'Conformance'), remarks: text(r, 'AssessorRemarks') });
  }

  protected async saveCheckpoints(body: CheckpointSaveRequest): Promise<void> {
    const e = this.checkpointEdit();
    const d = this.data();
    if (!e || !d) return;
    await this.save(this.api.checkpoints(d.zedId, d.certification, e.requirement['Id'], body), () => this.checkpointEdit.set(null));
  }

  /** The checkpoint of an option row of a requirement row (migration 0039), when the requirement has checkpoints. */
  protected checkpointOf(r: Row, o: Row): Checkpoint | undefined {
    return checkpointsOf(this.data()?.checkpoints, r['Id']).find((c) => c.optionCode === text(o, 'OptionCode').trim());
  }

  /** The requirement is answered checkpoint by checkpoint. */
  protected hasCheckpoints(r: Row): boolean {
    return checkpointsOf(this.data()?.checkpoints, r['Id']).length > 0;
  }

  /** The desktop assessor's answer of a checkpoint (an option row of a requirement row), when given. */
  protected answerOf(r: Row, o: Row): CheckpointValue | null {
    return this.checkpointOf(r, o)?.desktop?.value ?? null;
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
