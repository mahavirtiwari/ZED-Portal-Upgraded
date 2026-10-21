import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { num, text } from '../../assessment/assessment-shared';
import { isZedId } from '../../assessment/assessment.api';
import { BulletType, MilestoneBullet, MilestoneDetails, MilestonePhoto, MilestonesApi, Row, milestoneLevel } from './milestones.api';

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

/** Requirement columns per section of the parameters tab (label, column, multi-line). */
export const REQUIREMENT_FIELDS: Record<string, { label: string; multiline: boolean }> = {
  BaselineRemarks: { label: 'Baseline Diagnostic Remarks', multiline: true },
  EstimatedTimeInDays: { label: 'Estimated Time (in days)', multiline: false },
  HActionPlanRemarks: { label: 'Handholding Action Plan Remarks', multiline: true },
  Intervention: { label: 'Rationale for Technology Intervention', multiline: true },
  InterventionRemarks: { label: 'Technology Intervention Remarks', multiline: true },
  ProgressReviewRemarks: { label: 'Progress Review 1 Remarks', multiline: true },
  ProgressReviewRemarks2: { label: 'Progress Review 2 Remarks', multiline: true },
};

export const BULLET_LISTS: { type: BulletType; label: string }[] = [
  { type: 'BaselineDiagnostic', label: 'Gaps Identified (Baseline Diagnostic Study)' },
  { type: 'HandholdingActionPlan', label: 'Planned Activities (Handholding Action Plan)' },
  { type: 'TechnologyIntervention', label: 'Suggested Technology Intervention' },
];

const STATUS_TEXT: Record<number, string> = {
  8: 'Allotted to the Consultant Organisation',
  9: 'Consultants allotted',
  13: 'In progress with the consultants',
  15: 'Submitted to the Consultant Organisation',
  16: 'Completed, waiting for the MSME',
  99: 'Rejected',
  100: 'Accepted by the MSME',
};

/** An inline edit in progress: a requirement column, a bullet (new or existing) or a training's remarks. */
type Editing =
  | { kind: 'field'; id: unknown; field: string }
  | { kind: 'bullet'; id: number }
  | { kind: 'newBullet'; requirementId: unknown; type: BulletType }
  | { kind: 'training'; id: unknown };

type Dialog = 'consultantSubmit' | 'coSubmit' | 'sendBack' | 'reject' | null;

/**
 * The handholding milestone page of the Consultancy portal (old Assessment/SaDetails of ZEDCS_CONSULTANCY): the
 * consultants' and the Consultant Organisation's view of a milestone, the allow-listed edits (requirement remarks,
 * bullet lists, training remarks), the consultants' final submit and the CO's final submit, send back and reject.
 * The server decides what is editable (`permissions`, `Editable` per row) and checks it again on every call.
 */
@Component({
  selector: 'zed-consultancy-milestone-details',
  imports: [RouterLink, FormsModule, NgTemplateOutlet],
  templateUrl: './milestone-details.html',
  host: { '(document:keydown.escape)': 'preview.set(null)' },
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
  protected readonly bulletLists = BULLET_LISTS;

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

  private request = 0;

  protected readonly level = computed(() => milestoneLevel(this.certification()));
  protected readonly milestone = computed(() => this.data()?.milestone ?? 0);
  /** The current milestone's row (the procedures return one row per milestone). */
  protected readonly current = computed<Row>(() => (this.data()?.milestones ?? []).find((m) => num(m, 'NcCount') === this.milestone()) ?? this.data()?.milestones[0] ?? {});
  protected readonly perms = computed(() => this.data()?.permissions);
  protected readonly statusText = computed(() => STATUS_TEXT[this.data()?.status ?? 0] ?? '');
  /** Columns shown per requirement: the plan in milestone 1, then the progress reviews. */
  protected readonly shownFields = computed(() => {
    const m = this.milestone();
    const plan = ['BaselineRemarks', 'EstimatedTimeInDays', 'HActionPlanRemarks', 'Intervention', 'InterventionRemarks'];
    return [...plan, ...(m >= 2 ? ['ProgressReviewRemarks'] : []), ...(m >= 3 ? ['ProgressReviewRemarks2'] : [])];
  });

  constructor() {
    effect(() => {
      const zedId = this.zedId();
      const level = this.level();
      untracked(() => void this.load(zedId, level, true));
    });
  }

  // ------------------------------------------------------------------ view helpers

  protected requirementsOf(section: Row): Row[] {
    return (this.data()?.requirements ?? []).filter((r) => text(r, 'SectionCode') === text(section, 'SectionCode'));
  }

  protected optionsOf(r: Row): Row[] {
    return (this.data()?.options ?? []).filter((o) => text(o, 'SectionCode') === text(r, 'SectionCode') && text(o, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected bulletsOf(r: Row, type: string): MilestoneBullet[] {
    return (this.data()?.bullets ?? []).filter((b) => b.reqType === type && (b.requirementId ?? '').trim() === text(r, 'Id'));
  }

  protected photosOf(r: Row): MilestonePhoto[] {
    const p = r['Photos'];
    return Array.isArray(p) ? (p as MilestonePhoto[]) : [];
  }

  protected attendanceOf(consultant: Row): Row[] {
    return (this.data()?.attendance ?? []).filter((a) => text(a, 'ConsultantId') === text(consultant, 'ConsultantId'));
  }

  protected basicInfoKeys(row: Row): string[] {
    return Object.keys(row).filter((k) => k !== 'NcCount');
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
      if (first) this.tab.set(1);
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
