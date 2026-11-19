import { HttpClient, HttpContext } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ADMIN_PORTAL, AdminPortalService } from '../admin-portal';
import { ConfirmService } from '../confirm-dialog';
import { IndianTimePipe } from '../utc-time';
import { TextPipe, t } from '../../content/page-text';

/** Main saved, the surveillance portal did not: its message says which. */
class PartlySavedError extends Error {}

export type EsgFollowUpType = 'single_choice' | 'text_box';

export interface EsgFollowUp {
  id: number | null;
  showOn: 'Yes' | 'No';
  question: string;
  type: EsgFollowUpType;
  options: string[];
}

export interface EsgQuestion {
  id: number | null;
  question: string;
  options: string[];
  followUps: EsgFollowUp[];
}

export interface EsgSection {
  title: string;
  questions: EsgQuestion[];
}

export interface EsgChecklistResponse {
  checklist: { sections: EsgSection[] };
  customised: boolean;
  version: string;
  updatedBy: string | null;
  updatedOn: string | null;
}

/** A follow-up while it is edited: the options as one comma-separated text. */
interface FollowUpDraft {
  id: number | null;
  question: string;
  type: EsgFollowUpType;
  optionsText: string;
}

interface QuestionDraft {
  id: number | null;
  question: string;
  optionsText: string;
  /** One Admin (main portal): asked on the ZED Certification apps and / or on the surveillance apps. */
  inMain: boolean;
  inSurveillance: boolean;
  /** The follow-up on Yes and on No (the answers have one "if yes" and one "if no" column). */
  yes: FollowUpDraft | null;
  no: FollowUpDraft | null;
}

interface SectionDraft {
  title: string;
  questions: QuestionDraft[];
}

const SHOW_ON = ['Yes', 'No'] as const;

/**
 * Admin → Questionnaire → ESG Checklist (new in V4): the ESG and Social / OHS questions the MSME and surveillance apps
 * ask at the assessment (GetEsgChecklist; before, a fixed file). Each question is a single choice; a follow-up question
 * (single choice or text) can be asked when the answer is Yes, and another when it is No. The two sections stay (the
 * apps send them as two lists). A question keeps its code when edited; answers already given keep their texts. V4 layout:
 * the counts, a tab per section, a card per question with its options as chips and each follow-up as a branch under it,
 * and the save bar kept in view while there are changes.
 * <p>One Admin (V4, main portal): one list for the ZED Certification and Surveillance checklists, each question with
 * "Used in" ticks. Save writes main's checklist with the questions ticked for ZED Certification and the surveillance
 * portal's (through its own API) with those ticked for Surveillance, under the same codes; a question only the surveillance
 * portal has is listed with its tick. If the surveillance portal cannot be reached, only main's checklist is shown and saved.</p>
 */
@Component({
  selector: 'zed-staff-esg-checklist',
  imports: [FormsModule, IndianTimePipe, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'ESG Checklist' | t: 'staff.esgChecklist.title' }}</h3>
        <p class="page-sub">{{ 'The ESG and Social / OHS questions of the assessment in the mobile apps, with their options and follow-up questions.' | t: 'staff.esgChecklist.sub' }}</p>
      </div>
      @if (loaded()) {
        <span class="status-badge esg-state" [class.is-active]="customised()" [class.is-info]="!customised()">
          @if (!customised()) { {{ 'Standard checklist' | t: 'staff.esgChecklist.state.standard' }} }
          @else if (updatedBy() && updatedOn()) { {{ 'Changed by {name}, {date}' | t: 'staff.esgChecklist.state.changedByOn' : { name: updatedBy(), date: (updatedOn() | indianTime) } }} }
          @else if (updatedBy()) { {{ 'Changed by {name}' | t: 'staff.esgChecklist.state.changedBy' : { name: updatedBy() } }} }
          @else if (updatedOn()) { {{ 'Changed, {date}' | t: 'staff.esgChecklist.state.changedOn' : { date: (updatedOn() | indianTime) } }} }
          @else { {{ 'Changed' | t: 'staff.esgChecklist.state.changed' }} }
        </span>
      }
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    @if (survError()) {
      <div class="alert alert-warning" role="status">{{ 'Surveillance portal: {error} Only the ZED Certification checklist is shown and saved.' | t: 'staff.esgChecklist.survError' : { error: survError() } }}</div>
    }
    @if (loaded()) {
      <div class="esg-stats">
        <div class="stat"><span class="stat-value">{{ sections().length }}</span><span class="stat-label">{{ 'Sections' | t: 'staff.esgChecklist.stat.sections' }}</span></div>
        <div class="stat"><span class="stat-value">{{ totals().questions }}</span><span class="stat-label">{{ 'Questions' | t: 'staff.esgChecklist.stat.questions' }}</span></div>
        <div class="stat"><span class="stat-value">{{ totals().followUps }}</span><span class="stat-label">{{ 'Follow-up questions' | t: 'staff.esgChecklist.stat.followUps' }}</span></div>
      </div>

      <div class="esg-tabs" role="tablist" [attr.aria-label]="'Sections' | t: 'staff.esgChecklist.tabs.aria'">
        @for (s of sections(); track $index; let si = $index) {
          <button type="button" role="tab" class="esg-tab" [class.active]="active() === si" [attr.aria-selected]="active() === si" (click)="active.set(si)">
            {{ s.title || ('Section {number}' | t: 'staff.esgChecklist.tabs.untitled' : { number: si + 1 }) }} <span class="tab-count">{{ s.questions.length }}</span>
          </button>
        }
      </div>

      <div (input)="dirty.set(true)" (change)="dirty.set(true)">
        @for (s of sections(); track $index; let si = $index) {
          <section class="zed-card esg-section" [attr.aria-label]="s.title" [hidden]="active() !== si">
            <div class="section-head">
              <label class="form-label m-0" [for]="'esg-title-' + si">{{ 'Section {number} title' | t: 'staff.esgChecklist.section.titleLabel' : { number: si + 1 } }}</label>
              <input class="form-control esg-title" [id]="'esg-title-' + si" maxlength="100" [(ngModel)]="s.title" />
            </div>
            <ol class="esg-list">
              @for (q of s.questions; track q; let qi = $index) {
                <li class="esg-q">
                  <div class="q-head">
                    <span class="esg-no">{{ qi + 1 }}</span>
                    <label class="visually-hidden" [for]="'q-' + si + '-' + qi">{{ 'Question {number}' | t: 'staff.esgChecklist.question.label' : { number: qi + 1 } }}</label>
                    <textarea class="form-control q-text" rows="2" maxlength="500" [placeholder]="'Question' | t: 'staff.esgChecklist.question.placeholder'" [id]="'q-' + si + '-' + qi" [(ngModel)]="q.question"></textarea>
                    <div class="esg-tools">
                      <button type="button" class="btn btn-outline-primary btn-sm tool tool-move" [title]="'Move up' | t: 'staff.esgChecklist.question.moveUpTooltip'" [disabled]="qi === 0" (click)="move(s, qi, -1)" [attr.aria-label]="'Move question {number} up' | t: 'staff.esgChecklist.question.moveUpAria' : { number: qi + 1 }">&uarr;</button>
                      <button type="button" class="btn btn-outline-primary btn-sm tool tool-move" [title]="'Move down' | t: 'staff.esgChecklist.question.moveDownTooltip'" [disabled]="qi === s.questions.length - 1" (click)="move(s, qi, 1)" [attr.aria-label]="'Move question {number} down' | t: 'staff.esgChecklist.question.moveDownAria' : { number: qi + 1 }">&darr;</button>
                      <button type="button" class="btn btn-outline-danger btn-sm tool" [title]="'Remove' | t: 'staff.esgChecklist.question.removeButton'" [disabled]="s.questions.length === 1" (click)="remove(s, qi)" [attr.aria-label]="'Remove question {number}' | t: 'staff.esgChecklist.question.removeAria' : { number: qi + 1 }">{{ 'Remove' | t: 'staff.esgChecklist.question.removeButton' }}</button>
                    </div>
                  </div>

                  <div class="q-body">
                    @if (withSurveillance()) {
                      <div class="used-in" role="group" [attr.aria-label]="'Question {number} used in' | t: 'staff.esgChecklist.question.usedInAria' : { number: qi + 1 }">
                        <span class="esg-sub m-0">{{ 'Used in' | t: 'staff.esgChecklist.question.usedInLabel' }}</span>
                        <label class="form-check-label used"><input type="checkbox" class="form-check-input" [(ngModel)]="q.inMain" /> {{ 'ZED Certification' | t: 'staff.esgChecklist.question.usedInMain' }}</label>
                        <label class="form-check-label used"><input type="checkbox" class="form-check-input" [(ngModel)]="q.inSurveillance" /> {{ 'Surveillance' | t: 'staff.esgChecklist.question.usedInSurveillance' }}</label>
                        @if (!q.inMain && !q.inSurveillance) { <span class="unused">{{ 'Not used: it is removed when saved.' | t: 'staff.esgChecklist.question.unused' }}</span> }
                      </div>
                    }
                    <div class="opt-row">
                      <label class="esg-sub" [for]="'o-' + si + '-' + qi">{{ 'Options' | t: 'staff.esgChecklist.question.optionsLabel' }} <small>{{ '(comma-separated)' | t: 'staff.esgChecklist.question.optionsNote' }}</small></label>
                      <input class="form-control" [id]="'o-' + si + '-' + qi" [placeholder]="'Yes, No, Not Applicable' | t: 'staff.esgChecklist.question.optionsPlaceholder'" [(ngModel)]="q.optionsText" />
                      <div class="chips" aria-hidden="true">
                        @for (o of options(q.optionsText); track $index) { <span class="opt-chip">{{ o }}</span> }
                      </div>
                    </div>

                    <div class="follow-toggles">
                      <span class="esg-sub">{{ 'Follow-up question' | t: 'staff.esgChecklist.followUp.label' }}</span>
                      @for (on of showOn; track on) {
                        <div class="form-check form-switch follow-switch">
                          <input class="form-check-input" type="checkbox" role="switch" [id]="'f-' + on + si + '-' + qi" [checked]="!!follow(q, on)" (change)="toggle(q, on)" />
                          <label class="form-check-label" [for]="'f-' + on + si + '-' + qi">{{ 'When the answer is {answer}' | t: 'staff.esgChecklist.followUp.switch' : { answer: on } }}</label>
                        </div>
                      }
                    </div>

                    @for (on of showOn; track on) {
                      @if (follow(q, on); as f) {
                        <div class="esg-follow" [class.on-no]="on === 'No'">
                          <span class="branch">{{ 'If the answer is {answer}' | t: 'staff.esgChecklist.followUp.branch' : { answer: on } }}</span>
                          <div class="follow-grid">
                            <input class="form-control" maxlength="500" [placeholder]="'Follow-up question' | t: 'staff.esgChecklist.followUp.placeholder'" [attr.aria-label]="'Follow-up on {answer}' | t: 'staff.esgChecklist.followUp.questionAria' : { answer: on }" [(ngModel)]="f.question" />
                            <select class="form-select" [attr.aria-label]="'Answer type of the follow-up on {answer}' | t: 'staff.esgChecklist.followUp.typeAria' : { answer: on }" [(ngModel)]="f.type">
                              <option value="single_choice">{{ 'Single choice' | t: 'staff.esgChecklist.followUp.typeSingle' }}</option>
                              <option value="text_box">{{ 'Text' | t: 'staff.esgChecklist.followUp.typeText' }}</option>
                            </select>
                            @if (f.type === 'single_choice') {
                              <input class="form-control span-2" [placeholder]="'Options, comma-separated' | t: 'staff.esgChecklist.followUp.optionsPlaceholder'" [attr.aria-label]="'Options of the follow-up on {answer}' | t: 'staff.esgChecklist.followUp.optionsAria' : { answer: on }" [(ngModel)]="f.optionsText" />
                            } @else {
                              <small class="muted span-2">{{ 'The unit types its answer.' | t: 'staff.esgChecklist.followUp.textNote' }}</small>
                            }
                          </div>
                        </div>
                      }
                    }
                  </div>
                </li>
              }
            </ol>
            <button type="button" class="btn btn-outline-primary btn-sm add-q" (click)="add(s)">{{ '+ Add question' | t: 'staff.esgChecklist.addButton' }}</button>
          </section>
        }
        <small class="text-muted d-block">{{ 'Answers already given keep the questions as they were asked. The apps get a change the next time they open the checklist.' | t: 'staff.esgChecklist.note' }}</small>
        <div class="save-bar" [class.is-dirty]="dirty()">
          @if (dirty()) { <span class="unsaved me-auto">{{ 'Not saved yet.' | t: 'staff.esgChecklist.unsaved' }}</span> } @else { <span class="muted me-auto">{{ 'All changes saved.' | t: 'staff.esgChecklist.saved' }}</span> }
          @if (customised()) { <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="reset()">{{ 'Reset to standard' | t: 'staff.esgChecklist.resetButton' }}</button> }
          <button type="button" class="btn btn-primary" [disabled]="busy() || !dirty()" (click)="save()">{{ 'Save' | t: 'staff.esgChecklist.saveButton' }}</button>
        </div>
      </div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .page-head { align-items: center; }
    .esg-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-label { font-size: 13px; color: #5f6f70; }

    /* One tab per section. */
    .esg-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .esg-tab { display: inline-flex; align-items: center; gap: 8px; padding: 7px 18px; border-radius: 6px; border: 1px solid #cbd9da;
      background: #fff; color: var(--zt-mid2, #2f7c83); font-weight: 600; font-size: 14px; cursor: pointer; }
    .esg-tab:hover { background: #eef6f6; border-color: #45a5ad; }
    .esg-tab.active { background: var(--zt-dark, #23656b); border-color: var(--zt-dark, #23656b); color: #fff; }
    .tab-count { font-size: 12px; background: rgba(255,255,255,.25); border-radius: 10px; padding: 0 8px; }
    .esg-tab:not(.active) .tab-count { background: #eef6f6; color: #23474a; }

    .esg-section { margin-bottom: 12px; }
    .section-head { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid #eef3f3; }
    .section-head .form-label { white-space: nowrap; font-weight: 600; color: #3b4b4c; }
    .esg-title { font-weight: 700; max-width: 420px; }
    .esg-list { list-style: none; padding: 0; margin: 12px 0; }
    .esg-q { border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; background: #fff; }
    .esg-q:hover { border-color: #b9d8da; }
    .q-head { display: flex; gap: 12px; align-items: flex-start; }
    .esg-no { flex: none; width: 30px; height: 30px; margin-top: 4px; border-radius: 50%; background: #45a5ad; color: #fff; font-weight: 700; display: grid; place-items: center; font-size: 14px; }
    .q-text { flex: 1 1 auto; min-width: 0; font-weight: 600; color: #232527; min-height: 0 !important; resize: vertical; }
    .esg-tools { display: flex; gap: 4px; flex: none; }
    .esg-tools .tool { white-space: nowrap; text-transform: none; }
    .esg-tools .tool-move { width: 32px; padding-left: 0; padding-right: 0; font-weight: 700; }
    /* The checklist state beside the title, in sentence case (not a lone uppercase badge). */
    .esg-state { text-transform: none; letter-spacing: 0; white-space: normal; }
    .q-body { margin-left: 42px; }
    .esg-sub { display: block; margin: 10px 0 4px; font-size: 13px; font-weight: 600; color: #3b4b4c; }
    .esg-sub small { font-weight: 400; color: #5f6f70; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .opt-chip { font-size: 12px; font-weight: 600; background: #eef6f6; color: #23474a; border-radius: 12px; padding: 2px 10px; }
    .follow-toggles { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 20px; margin-top: 4px; }
    .follow-toggles .esg-sub { flex-basis: 100%; }
    .follow-switch { margin: 0; font-size: 13.5px; }
    .esg-follow { margin-top: 10px; padding: 10px 12px; border-left: 3px solid #45a5ad; background: #f4fafa; border-radius: 0 10px 10px 0; }
    .esg-follow.on-no { border-left-color: #d68a2f; background: #fdf8f1; }
    .branch { display: inline-block; font-size: 12px; font-weight: 700; color: var(--zt-mid2, #2f7c83); margin-bottom: 6px; }
    .on-no .branch { color: #8a5a12; }
    .follow-grid { display: grid; grid-template-columns: minmax(0, 1fr) 160px; gap: 8px; align-items: center; }
    .follow-grid .span-2 { grid-column: 1 / -1; }
    .add-q { margin-top: 2px; }
    .used-in { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; margin-top: 8px; padding: 6px 10px; background: #f4fafa; border-radius: 8px; }
    .used-in .used { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; color: #23474a; }
    .used-in .form-check-input { margin: 0; float: none; }
    .unused { font-size: 12.5px; font-weight: 600; color: #a8303a; }

    /* Save bar: stays at the bottom of the window while there are changes. */
    .save-bar { position: sticky; bottom: 0; z-index: 5; display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 12px 16px;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 -2px 12px rgba(16, 61, 64, 0.08); }
    .save-bar.is-dirty { border-color: #e9c46a; background: #fffcf2; }
    .unsaved { font-weight: 600; color: #8a6100; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .esg-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .section-head { flex-direction: column; align-items: stretch; gap: 4px; }
      .q-head { flex-wrap: wrap; }
      .q-text { flex-basis: calc(100% - 42px); min-height: 88px !important; }
      .esg-tools { margin-left: 42px; }
      .q-body { margin-left: 0; }
      .follow-grid { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class EsgChecklistPage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private readonly portals = inject(AdminPortalService);
  private static readonly url = '/api/staff/settings/esg-checklist';
  private static readonly onSurveillance = new HttpContext().set(ADMIN_PORTAL, 'surveillance');

  /** The surveillance portal's checklist is edited here too (main portal, reached). */
  protected readonly withSurveillance = signal(false);
  protected readonly survError = signal('');

  protected readonly showOn = SHOW_ON;
  protected readonly sections = signal<SectionDraft[]>([]);
  /** The section shown (the tabs). */
  protected readonly active = signal(0);
  protected readonly totals = computed(() => {
    const questions = this.sections().flatMap((s) => s.questions);
    return { questions: questions.length, followUps: questions.reduce((n, q) => n + (q.yes ? 1 : 0) + (q.no ? 1 : 0), 0) };
  });
  /** The options as chips under the box. */
  protected readonly options = splitOptions;
  protected readonly customised = signal(false);
  protected readonly updatedBy = signal<string | null>(null);
  protected readonly updatedOn = signal<string | null>(null);
  protected readonly loaded = signal(false);
  protected readonly dirty = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected follow(q: QuestionDraft, on: 'Yes' | 'No'): FollowUpDraft | null {
    return on === 'Yes' ? q.yes : q.no;
  }

  protected toggle(q: QuestionDraft, on: 'Yes' | 'No'): void {
    const f = this.follow(q, on) ? null : { id: null, question: '', type: 'text_box' as const, optionsText: 'Yes, No' };
    if (on === 'Yes') q.yes = f;
    else q.no = f;
    this.changed();
  }

  protected add(s: SectionDraft): void {
    s.questions.push({ id: null, question: '', optionsText: 'Yes, No, Not Applicable', yes: null, no: null, inMain: true, inSurveillance: this.withSurveillance() });
    this.changed();
  }

  protected async remove(s: SectionDraft, index: number): Promise<void> {
    const ok = await this.confirms.ask({
      title: t('staff.esgChecklist.removeConfirm.title', 'Remove Question {number}?', { number: index + 1 }),
      message: t('staff.esgChecklist.removeConfirm.message', 'Answers already given keep it.'),
      confirmLabel: t('staff.esgChecklist.removeConfirm.button', 'Remove'), danger: true,
    });
    if (!ok) return;
    s.questions.splice(index, 1);
    this.changed();
  }

  protected move(s: SectionDraft, index: number, by: number): void {
    const [q] = s.questions.splice(index, 1);
    s.questions.splice(index + by, 0, q);
    this.changed();
  }

  protected async save(): Promise<void> {
    if (!this.withSurveillance()) {
      await this.send(() => this.http.put<MessageResponse>(EsgChecklistPage.url, { sections: this.sections().map((x) => toSection(x)) }));
      return;
    }
    // The checklist of each portal needs a question in every section (its two lists in the apps).
    const needs = [
      { keep: (q: QuestionDraft) => q.inMain,
        message: (section: string) => t('staff.esgChecklist.error.emptyMain', 'The section "{section}" needs at least one question for ZED Certification.', { section }) },
      { keep: (q: QuestionDraft) => q.inSurveillance,
        message: (section: string) => t('staff.esgChecklist.error.emptySurveillance', 'The section "{section}" needs at least one question for Surveillance.', { section }) },
    ];
    for (const { keep, message } of needs) {
      const empty = this.sections().find((x) => !x.questions.some(keep));
      if (empty) {
        this.success.set('');
        this.error.set(message(empty.title));
        return;
      }
    }
    await this.send(async () => {
      const drafts = this.sections();
      const main = await firstValueFrom(this.http.put<MessageResponse>(EsgChecklistPage.url, { sections: drafts.map((x) => toSection(x, (q) => q.inMain)) }));
      // Main gave the new questions their codes: the surveillance portal gets the same ones.
      const saved = (await firstValueFrom(this.http.get<EsgChecklistResponse>(EsgChecklistPage.url))).checklist.sections;
      const sections = drafts.map((d, si) => {
        const mainQuestions = saved[si]?.questions ?? [];
        let k = 0;
        const withIds = d.questions.map((q) => {
          if (!q.inMain) return q;
          const sq = mainQuestions[k++];
          if (!sq) return q;
          const fid = (on: 'Yes' | 'No', f: FollowUpDraft | null) => (f ? { ...f, id: sq.followUps.find((x) => x.showOn === on)?.id ?? f.id } : f);
          return { ...q, id: sq.id, yes: fid('Yes', q.yes), no: fid('No', q.no) };
        });
        const mainIds = new Set(saved.flatMap((x) => x.questions).flatMap((q) => [q.id, ...q.followUps.map((f) => f.id)]));
        // A question only the surveillance portal has keeps its codes unless main now uses them (then it gets new ones there).
        const free = <T extends { id: number | null }>(x: T): T => (x.id !== null && mainIds.has(x.id) ? { ...x, id: null } : x);
        return { ...d, questions: withIds.map((q) => (q.inMain ? q : { ...free(q), yes: q.yes && free(q.yes), no: q.no && free(q.no) })) };
      });
      try {
        await firstValueFrom(this.http.put<MessageResponse>(EsgChecklistPage.url, { sections: sections.map((x) => toSection(x, (q) => q.inSurveillance)) },
          { context: EsgChecklistPage.onSurveillance }));
      } catch (err) {
        // Main is already saved: say so, so the admin saves again for Surveillance only rather than doubting both.
        await this.load(false);
        throw new PartlySavedError(t('staff.esgChecklist.error.partlySaved', 'The checklist was saved for ZED Certification, but not for Surveillance: {error} Please save again.', { error: apiErrorMessage(err) }));
      }
      return { message: main.message.replace('ESG checklist saved.', t('staff.esgChecklist.toast.savedBoth', 'ESG checklist saved for ZED Certification and Surveillance.')) };
    });
  }

  protected async reset(): Promise<void> {
    const ok = await this.confirms.ask({
      title: t('staff.esgChecklist.resetConfirm.title', 'Reset to the Standard Checklist?'),
      message: t('staff.esgChecklist.resetConfirm.message', 'The standard ESG checklist is used again. Your questions are removed.'),
      confirmLabel: t('staff.esgChecklist.resetConfirm.button', 'Reset'), danger: true,
    });
    if (!ok) return;
    await this.send(async () => {
      const r = await firstValueFrom(this.http.delete<MessageResponse>(EsgChecklistPage.url));
      if (this.withSurveillance()) await firstValueFrom(this.http.delete<MessageResponse>(EsgChecklistPage.url, { context: EsgChecklistPage.onSurveillance }));
      return r;
    });
  }

  private changed(): void {
    this.sections.set([...this.sections()]);
    this.dirty.set(true);
  }

  private async send(call: () => Observable<MessageResponse> | Promise<MessageResponse>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const pending = call();
      const r = pending instanceof Promise ? await pending : await firstValueFrom(pending);
      await this.load(false);
      this.success.set(r.message);
    } catch (err) {
      this.error.set(err instanceof PartlySavedError ? err.message : apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    try {
      const r = await firstValueFrom(this.http.get<EsgChecklistResponse>(EsgChecklistPage.url));
      const surveillance = await this.loadSurveillance();
      this.withSurveillance.set(surveillance !== null);
      this.sections.set(merge(r.checklist.sections.map(toDraft), surveillance?.map(toDraft) ?? null));
      this.customised.set(r.customised);
      this.updatedBy.set(r.updatedBy);
      this.updatedOn.set(r.updatedOn);
      this.dirty.set(false);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }

  /** The surveillance portal's checklist (main portal only), or null when not edited here or not reached. */
  private async loadSurveillance(): Promise<EsgSection[] | null> {
    if (!this.portals.enabled) return null;
    try {
      const r = await firstValueFrom(this.http.get<EsgChecklistResponse>(EsgChecklistPage.url, { context: EsgChecklistPage.onSurveillance }));
      this.survError.set('');
      return r.checklist.sections;
    } catch (err) {
      this.survError.set(apiErrorMessage(err));
      return null;
    }
  }
}

/**
 * Main's questions with their Surveillance tick (the surveillance portal has a question with that code), then, per section,
 * the questions only the surveillance portal has. Without the surveillance list every question is main's.
 */
function merge(main: SectionDraft[], surveillance: SectionDraft[] | null): SectionDraft[] {
  if (!surveillance) return main.map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, inMain: true, inSurveillance: false })) }));
  return main.map((s, si) => {
    const theirs = surveillance[si]?.questions ?? [];
    const ids = new Set(s.questions.map((q) => q.id).filter((id) => id !== null));
    return {
      ...s,
      questions: [
        ...s.questions.map((q) => ({ ...q, inMain: true, inSurveillance: q.id !== null && theirs.some((t) => t.id === q.id) })),
        ...theirs.filter((t) => t.id === null || !ids.has(t.id)).map((t) => ({ ...t, inMain: false, inSurveillance: true })),
      ],
    };
  });
}

const splitOptions = (text: string): string[] => text.split(',').map((o) => o.trim()).filter((o) => o.length > 0);

function toDraft(s: EsgSection): SectionDraft {
  const follow = (q: EsgQuestion, on: 'Yes' | 'No'): FollowUpDraft | null => {
    const f = q.followUps.find((x) => x.showOn === on);
    return f ? { id: f.id, question: f.question, type: f.type, optionsText: f.options.join(', ') } : null;
  };
  return {
    title: s.title,
    questions: s.questions.map((q) => ({
      id: q.id, question: q.question, optionsText: q.options.join(', '), yes: follow(q, 'Yes'), no: follow(q, 'No'), inMain: true, inSurveillance: false,
    })),
  };
}

/** The section as the API takes it; <paramref name="keep"/> picks the questions of one portal. */
function toSection(s: SectionDraft, keep: (q: QuestionDraft) => boolean = () => true): EsgSection {
  return {
    title: s.title,
    questions: s.questions.filter(keep).map((q) => ({
      id: q.id,
      question: q.question,
      options: splitOptions(q.optionsText),
      followUps: SHOW_ON.flatMap((on) => {
        const f = on === 'Yes' ? q.yes : q.no;
        return f ? [{ id: f.id, showOn: on, question: f.question, type: f.type, options: f.type === 'single_choice' ? splitOptions(f.optionsText) : [] }] : [];
      }),
    })),
  };
}
