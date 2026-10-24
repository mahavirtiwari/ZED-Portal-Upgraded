import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { num, text } from '../../assessment/assessment-shared';
import { isZedId } from '../../assessment/assessment.api';
import { BulletType, MilestoneBullet, MilestoneDetails, MilestoneMeeting, MilestonePhoto, MilestonesApi, Row, milestoneLevel } from './milestones.api';

/** Tabs of the old consultancy SaDetails page. */
export const MILESTONE_TABS: Record<number, string> = {
  1: 'Overview',
  2: 'Consultancy Plan',
  3: 'Attendance',
  4: 'Opening Meeting',
  5: 'Consultants Selfie',
  6: 'Basic Information',
  7: 'Site Tour',
  8: 'Trainings',
  9: 'Parameters',
  10: 'Closing Meeting',
};

/** Requirement columns of the parameters tab; the page shows them under its own captions, `label` names the EDIT button. */
export const REQUIREMENT_FIELDS: Record<string, { label: string }> = {
  BaselineRemarks: { label: 'Baseline Diagnostic Remarks' },
  EstimatedTimeInDays: { label: 'Estimated Time (in days)' },
  HActionPlanRemarks: { label: 'Handholding Action Plan Remarks' },
  Intervention: { label: 'Rationale for Technology Intervention' },
  InterventionRemarks: { label: 'Technology Intervention Remarks' },
  ProgressReviewRemarks: { label: 'Progress Review 1 Remarks' },
  ProgressReviewRemarks2: { label: 'Progress Review 2 Remarks' },
};

/** The progress review tables of a parameter, shown once its section reaches the milestone (MsmeSections.NcCount). */
export const PROGRESS_REVIEWS = [
  { milestone: 2, title: 'Progress Review 1', completed: 'IsProposedActivityCompleted', field: 'ProgressReviewRemarks' },
  { milestone: 3, title: 'Progress Review 2', completed: 'IsProposedActivityCompleted2', field: 'ProgressReviewRemarks2' },
];

interface BasicInfoField {
  field: string;
  label: string;
  /** Half width (the energy sources' unit and share). */
  half?: boolean;
  /** Black sub-heading above the field (the energy source). */
  heading?: string;
}

const ENERGY_SOURCES: [string, string][] = [['Electri', 'Electrical'], ['Solar', 'Solar'], ['Wind', 'Wind'], ['Fossil', 'Fossil Fuel'], ['Gas', 'Gas'], ['Others', 'Others']];
const MEASURES_TAKEN = 'Measures Taken (New technologies, new machines, new processes etc.)';

/** The "Basic Information" tab (ConsultancyBasicInformation), its sections, captions and order as on the old page. */
export const BASIC_INFO_SECTIONS: { title: string; fields: BasicInfoField[] }[] = [
  {
    title: 'Occupational (Workplace) Safety', fields: [
      { field: 'NumOfAccedents', label: 'No. of accidents (incl. fatalities & disabilities caused, if any)' },
      { field: 'NumOfNearMisses', label: 'No. of near misses' },
      { field: 'ManHoursLast', label: 'Man hours lost' },
      { field: 'LosttimeInjuryfreqRate', label: 'Lost Time Injury Frequency Rate (LTIFR)' },
    ],
  },
  {
    title: 'Measurement of Timely Delivery', fields: [
      { field: 'NumOfDeliveries', label: 'Number of Deliveries' },
      { field: 'NumOfDeliveriesOntimeFull', label: 'Number of Deliveries made On Time In Full (OTIF) per month' },
    ],
  },
  {
    title: 'Planned Maintenance & Calibration', fields: [
      { field: 'MeanTimeToRepair', label: 'Mean Time To Repair (MTTR)' },
      { field: 'MeanTimeBetweenFailure', label: 'Mean Time Between Failure (MTBF)' },
    ],
  },
  {
    title: 'Energy Management', fields: [
      ...ENERGY_SOURCES.flatMap(([prefix, heading]): BasicInfoField[] => [
        { field: `${prefix}Unit`, label: 'Unit', half: true, heading },
        { field: `${prefix}TotConsumpPer`, label: '% of total consumption', half: true },
      ]),
      { field: 'TotalCost', label: 'Total Cost' },
      { field: 'EnergyMgmtMeasuresTaken', label: MEASURES_TAKEN },
    ],
  },
  {
    title: 'Environment Management', fields: [
      { field: 'Cox', label: 'COx (please mention unit)' },
      { field: 'Nox', label: 'NOx (please mention unit)' },
      { field: 'Sox', label: 'SOx (please mention unit)' },
      { field: 'SuspPertiMaterial', label: 'Suspended Particulate Material (SPM)' },
      { field: 'TotSuspenSolid', label: 'Total Suspended Solid (TSS)' },
      { field: 'BioChemOxyDemand', label: 'Biochemical Oxygen Demand (BOD)' },
      { field: 'SolidWaste', label: 'Solid Waste (Kg/Month)' },
      { field: 'PlasticWaste', label: 'Plastic Waste (Kg/Month)' },
      { field: 'Ewaste', label: 'e-Waste (Kg/Month)' },
      { field: 'hazardWaste', label: 'Hazardous Waste (Kg/Month)' },
      { field: 'NoiseLevel', label: 'Noise Level (dB)' },
      { field: 'EnviMgmtMeasuresTaken', label: MEASURES_TAKEN },
    ],
  },
  {
    title: 'Human Resource Management', fields: [
      { field: 'EmpEngagedInActivities', label: '% of employees engaged in improvement activities' },
      { field: 'NumOfSuggestions', label: 'No. of suggestions received' },
      { field: 'HrmMeasuresTaken', label: 'Measures Taken to develop human resources' },
    ],
  },
  {
    title: 'Measurement & Analysis', fields: [
      { field: 'Defects', label: 'Defects (%)' },
      { field: 'ReWork', label: 'Rework (%)' },
      { field: 'CustRejections', label: 'Customer Rejections (%)' },
      { field: 'NumOfCustComplaints', label: 'Number of Customer Complaints' },
      { field: 'NumOfComplaintsResolved', label: 'Customer Complaints resolved (%)' },
      { field: 'CustSatisLevel', label: 'Customer Satisfaction level (%)' },
      { field: 'CostOfPoorQuality', label: 'Cost of Poor Quality (COPQ)' },
    ],
  },
  {
    title: 'Natural Resources Management', fields: [
      { field: 'Water', label: 'Water (Litres)' },
      { field: 'Minarals', label: 'Minerals (Coal) (Kg)' },
      { field: 'Wood', label: 'Wood (Kg)' },
      { field: 'NrmOthers', label: 'Others' },
      { field: 'WaterRecycling', label: 'Water recycling (Litres)' },
      { field: 'Waterreuse', label: 'Water reuse (Litres)' },
      { field: 'RainWaterHarvest', label: 'Rain water harvesting (Litres)' },
      { field: 'NumofTreesPlanted', label: 'No. of Tree planted' },
      { field: 'NrmMeasuresTaken', label: MEASURES_TAKEN },
    ],
  },
  {
    title: 'Financial Performance (Previous Financial Year)', fields: [
      { field: 'TurnOver', label: 'Turnover' },
      { field: 'GrossProfit', label: 'Gross Profit' },
    ],
  },
];

/** An inline edit in progress: a requirement column, a bullet (new or existing) or a training's remarks. */
type Editing =
  | { kind: 'field'; id: unknown; field: string }
  | { kind: 'bullet'; id: number }
  | { kind: 'newBullet'; requirementId: unknown; type: BulletType }
  | { kind: 'training'; id: unknown };

type Dialog = 'consultantSubmit' | 'coSubmit' | 'sendBack' | 'reject' | 'meetingRemarks' | 'finalComments' | null;

/**
 * The handholding milestone page of the Consultancy portal (old Assessment/SaDetails of ZEDCS_CONSULTANCY): the
 * consultants' and the Consultant Organisation's view of a milestone, the allow-listed edits (requirement remarks,
 * bullet lists, training remarks), the consultants' final submit and the CO's final submit, send back and "Edit Remarks"
 * of the consultant's final comments (the old page never showed a Reject button, so neither does this one).
 * The server decides what is editable (`permissions`, `Editable` per row, `editable` per meeting) and checks it again on
 * every call. The layout is the old page's: the overview per milestone, the parameters as an accordion with a table per
 * milestone, the basic information per section.
 */
@Component({
  selector: 'zed-consultancy-milestone-details',
  imports: [RouterLink, FormsModule, NgTemplateOutlet],
  templateUrl: './milestone-details.html',
  host: { '(document:keydown.escape)': 'preview.set(null)' },
  styles: `
    .milestone-border { border-left: 4px solid #ad1616 !important; }
    .section-toggle { cursor: pointer; }
    .evidence-img img { max-width: 100%; }
  `,
})
export class MilestoneDetailsPage {
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();

  private readonly api = inject(MilestonesApi);
  protected readonly t = text;
  protected readonly n = num;
  protected readonly tabs = MILESTONE_TABS;
  protected readonly tabIds = Object.keys(MILESTONE_TABS).map(Number);
  protected readonly fieldInfo = REQUIREMENT_FIELDS;
  protected readonly progressReviews = PROGRESS_REVIEWS;
  protected readonly basicInfoSections = BASIC_INFO_SECTIONS;

  protected readonly data = signal<MilestoneDetails | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly tab = signal(1);
  protected readonly preview = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly draft = signal('');
  protected readonly dialog = signal<Dialog>(null);
  protected readonly dialogText = signal('');
  protected readonly confirmed = signal(false);
  protected readonly dialogError = signal('');
  /** Sections open in the parameters accordion (all closed at first, as on the old page). */
  protected readonly openSections = signal<ReadonlySet<string>>(new Set());
  private meetingId: number | null = null;

  private request = 0;

  protected readonly level = computed(() => milestoneLevel(this.certification()));
  protected readonly milestone = computed(() => this.data()?.milestone ?? 0);
  protected readonly perms = computed(() => this.data()?.permissions);
  /** The milestone rows in order (the old page's msme, msme2, msme3). */
  protected readonly milestoneRows = computed(() => (this.data()?.milestones ?? []).slice(0, 3));

  constructor() {
    effect(() => {
      const zedId = this.zedId();
      const level = this.level();
      untracked(() => void this.load(zedId, level, true));
    });
  }

  // ------------------------------------------------------------------ view helpers

  /** The row of milestone `n` (1..3). */
  protected milestoneRow(n: number): Row | null {
    const rows = this.milestoneRows();
    return rows.find((m) => num(m, 'NcCount') === n) ?? rows[n - 1] ?? null;
  }

  protected allotmentsOf(section: Row): Row[] {
    return (this.data()?.allotments ?? []).filter((a) => text(a, 'SectionCode') === text(section, 'SectionCode'));
  }

  protected isOpen(section: Row): boolean {
    return this.openSections().has(text(section, 'SectionCode'));
  }

  protected toggle(section: Row): void {
    const code = text(section, 'SectionCode');
    const open = new Set(this.openSections());
    if (open.has(code)) open.delete(code);
    else open.add(code);
    this.openSections.set(open);
  }

  protected requirementsOf(section: Row): Row[] {
    return (this.data()?.requirements ?? []).filter((r) => text(r, 'SectionCode') === text(section, 'SectionCode'));
  }

  protected optionsOf(r: Row): Row[] {
    return (this.data()?.options ?? []).filter((o) => text(o, 'SectionCode') === text(r, 'SectionCode') && text(o, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected subOptionsOf(o: Row): Row[] {
    return (this.data()?.subOptions ?? []).filter(
      (so) => text(so, 'SectionCode') === text(o, 'SectionCode') && text(so, 'RequirementCode') === text(o, 'RequirementCode') && text(so, 'OptionCode') === text(o, 'OptionCode'),
    );
  }

  protected bulletsOf(r: Row, type: string): MilestoneBullet[] {
    return (this.data()?.bullets ?? []).filter((b) => b.reqType === type && (b.requirementId ?? '').trim() === text(r, 'Id'));
  }

  /** A requirement's photos of one milestone. */
  protected photosOf(r: Row, milestone: number): MilestonePhoto[] {
    const p = r['Photos'];
    return Array.isArray(p) ? (p as MilestonePhoto[]).filter((x) => x.ncCount === milestone) : [];
  }

  protected byMilestone(photos: MilestonePhoto[], milestone: number | null): MilestonePhoto[] {
    return photos.filter((p) => p.ncCount === milestone);
  }

  /** Photos of a training by their name ("Training Photo", "Attendance Sheet"). */
  protected named(photos: MilestonePhoto[], name: string): MilestonePhoto[] {
    return photos.filter((p) => (p.name ?? '').includes(name));
  }

  /** A handholding training's photos: those of its consultant and milestone. */
  protected trainingPhotos(photos: MilestonePhoto[], training: Row): MilestonePhoto[] {
    return photos.filter((p) => (p.assessorId ?? '').trim() === text(training, 'AssessorId') && p.ncCount === num(training, 'NcCount'));
  }

  /** "October 05, 2025 10:30 AM" as the old page's date filter showed it: "Oct 05, 2025". */
  protected shortDate(value: string): string {
    const m = /^([A-Za-z]{3})[A-Za-z]* (\d{1,2}), (\d{4})/.exec(value);
    return m ? `${m[1]} ${m[2].padStart(2, '0')}, ${m[3]}` : value;
  }

  protected mapUrl(lat: string, lng: string): string {
    const a = Number(lat);
    const b = Number(lng);
    return lat && lng && Number.isFinite(a) && Number.isFinite(b) ? `https://www.google.com/maps?q=${a},${b}` : '';
  }

  protected attendanceOf(consultant: Row): Row[] {
    return (this.data()?.attendance ?? []).filter((a) => text(a, 'ConsultantId') === text(consultant, 'ConsultantId'));
  }

  protected canEditField(r: Row, field: string): boolean {
    return r['Editable'] === true && (this.perms()?.editableFields ?? []).includes(field);
  }

  protected canAddBullet(r: Row): boolean {
    return r['Editable'] === true && !!this.perms()?.canEditBullets;
  }

  protected isEditing(e: Editing): boolean {
    const cur = this.editing();
    if (!cur || cur.kind !== e.kind) return false;
    switch (e.kind) {
      case 'field':
        return cur.kind === 'field' && String(cur.id) === String(e.id) && cur.field === e.field;
      case 'bullet':
        return cur.kind === 'bullet' && cur.id === e.id;
      case 'newBullet':
        return cur.kind === 'newBullet' && String(cur.requirementId) === String(e.requirementId) && cur.type === e.type;
      case 'training':
        return cur.kind === 'training' && String(cur.id) === String(e.id);
    }
  }

  protected openImage(src: string | null | undefined): void {
    if (src) this.preview.set(src);
  }

  // ------------------------------------------------------------------ edits

  protected startEdit(e: Editing, value: unknown): void {
    this.editing.set(e);
    this.draft.set(value === null || value === undefined ? '' : String(value));
  }

  protected cancelEdit(): void {
    this.editing.set(null);
  }

  protected async saveEdit(): Promise<void> {
    const e = this.editing();
    const d = this.data();
    const value = this.draft().trim();
    if (!e || !d) return;
    if (!value) {
      this.notice.set({ ok: false, text: 'Please enter a value.' });
      return;
    }
    const call: Observable<{ message: string }> =
      e.kind === 'field'
        ? this.api.updateRequirement(d.zedId, d.certification, e.id, e.field, value)
        : e.kind === 'bullet'
          ? this.api.editBullet(d.zedId, d.certification, e.id, value)
          : e.kind === 'newBullet'
            ? this.api.addBullet(d.zedId, d.certification, e.requirementId, e.type, value)
            : this.api.trainingRemarks(d.zedId, d.certification, e.id, value);
    if (await this.run(call)) this.editing.set(null);
  }

  protected async deleteBullet(b: MilestoneBullet): Promise<void> {
    const d = this.data();
    if (!d || !b.editable || !confirm('Delete this item?')) return;
    await this.run(this.api.deleteBullet(d.zedId, d.certification, b.id));
  }

  // ------------------------------------------------------------------ final submit / decisions

  protected async openConsultantSubmit(): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.busy.set(true);
    try {
      const check = await firstValueFrom(this.api.consultantCheck(d.zedId, d.certification));
      if (!check.allowed) {
        this.notice.set({ ok: false, text: check.message });
        return;
      }
      this.openDialog('consultantSubmit');
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected openMeetingRemarks(m: MilestoneMeeting): void {
    if (!m.editable || m.id === null) return;
    this.openDialog('meetingRemarks');
    this.meetingId = m.id;
    this.dialogText.set(m.comments ?? '');
  }

  /** The CO's "Edit Remarks" of the consultant's final comments of the milestone under review (prefilled). */
  protected openFinalComments(row: Row): void {
    if (!this.perms()?.canEditFinalComments) return;
    this.openDialog('finalComments');
    this.dialogText.set(text(row, 'SaAssessorRemarks'));
  }

  /** "Edit Remarks" under a closing meeting: the CO, for the milestone under review (status 15), as on the old page. */
  protected canEditFinalComments(m: MilestoneMeeting, row: Row): boolean {
    return !!this.perms()?.canEditFinalComments && m.ncCount === this.milestone() && num(row, 'CertificationStatus') === 15;
  }

  protected openDialog(d: Exclude<Dialog, null>): void {
    this.dialogText.set('');
    this.confirmed.set(false);
    this.dialogError.set('');
    this.dialog.set(d);
  }

  protected canSubmitDialog(): boolean {
    switch (this.dialog()) {
      case 'consultantSubmit':
      case 'sendBack':
      case 'meetingRemarks':
      case 'finalComments':
        return this.dialogText().trim().length > 0;
      case 'coSubmit':
      case 'reject':
        return this.confirmed();
      default:
        return false;
    }
  }

  protected async submitDialog(): Promise<void> {
    const dlg = this.dialog();
    const d = this.data();
    if (!dlg || !d || !this.canSubmitDialog()) return;
    const remarks = this.dialogText().trim();
    const call: Observable<{ message: string }> =
      dlg === 'consultantSubmit'
        ? this.api.consultantFinalSubmit(d.zedId, d.certification, remarks)
        : dlg === 'coSubmit'
          ? this.api.finalSubmit(d.zedId, d.certification)
          : dlg === 'sendBack'
            ? this.api.sendBack(d.zedId, d.certification, remarks)
            : dlg === 'meetingRemarks'
              ? this.api.meetingRemarks(d.zedId, d.certification, this.meetingId ?? 0, remarks)
              : dlg === 'finalComments'
                ? this.api.finalComments(d.zedId, d.certification, remarks)
                : this.api.reject(d.zedId, d.certification);
    this.busy.set(true);
    this.dialogError.set('');
    try {
      const res = await firstValueFrom(call);
      this.dialog.set(null);
      this.notice.set({ ok: true, text: res.message });
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.reload();
  }

  protected refresh(): void {
    void this.reload();
  }

  // ------------------------------------------------------------------ plumbing

  private async run(call: Observable<{ message: string }>): Promise<boolean> {
    this.busy.set(true);
    try {
      const res = await firstValueFrom(call);
      this.notice.set({ ok: true, text: res.message });
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
      return false;
    } finally {
      this.busy.set(false);
    }
    await this.reload();
    return true;
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
      if (first) {
        this.tab.set(1);
        this.openSections.set(new Set());
      }
    } catch (err) {
      if (request !== this.request) return;
      this.data.set(null);
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 404
          ? 'Milestone details are not available, or this unit is not allotted to you.'
          : apiErrorMessage(err),
      );
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
