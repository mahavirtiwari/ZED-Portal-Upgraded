import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';

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
 */
@Component({
  selector: 'zed-staff-esg-checklist',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">ESG Checklist</h3>
        <p class="page-sub">The ESG and Social / OHS questions of the assessment in the mobile apps, with their options and follow-up questions.</p>
      </div>
      @if (loaded()) {
        <span class="status-badge" [class.is-active]="customised()" [class.is-info]="!customised()">
          @if (customised()) { Changed{{ updatedBy() ? ' by ' + updatedBy() : '' }}{{ updatedOn() ? ', ' + (updatedOn() | date: 'dd-MM-yyyy HH:mm') : '' }} } @else { Standard checklist }
        </span>
      }
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    @if (loaded()) {
      <div class="esg-stats">
        <div class="stat"><span class="stat-value">{{ sections().length }}</span><span class="stat-label">Sections</span></div>
        <div class="stat"><span class="stat-value">{{ totals().questions }}</span><span class="stat-label">Questions</span></div>
        <div class="stat"><span class="stat-value">{{ totals().followUps }}</span><span class="stat-label">Follow-up questions</span></div>
      </div>

      <div class="esg-tabs" role="tablist" aria-label="Sections">
        @for (s of sections(); track $index; let si = $index) {
          <button type="button" role="tab" class="esg-tab" [class.active]="active() === si" [attr.aria-selected]="active() === si" (click)="active.set(si)">
            {{ s.title || 'Section ' + (si + 1) }} <span class="tab-count">{{ s.questions.length }}</span>
          </button>
        }
      </div>

      <div (input)="dirty.set(true)" (change)="dirty.set(true)">
        @for (s of sections(); track $index; let si = $index) {
          <section class="zed-card esg-section" [attr.aria-label]="s.title" [hidden]="active() !== si">
            <div class="section-head">
              <label class="form-label m-0" [for]="'esg-title-' + si">Section {{ si + 1 }} title</label>
              <input class="form-control esg-title" [id]="'esg-title-' + si" maxlength="100" [(ngModel)]="s.title" />
            </div>
            <ol class="esg-list">
              @for (q of s.questions; track q; let qi = $index) {
                <li class="esg-q">
                  <div class="q-head">
                    <span class="esg-no">{{ qi + 1 }}</span>
                    <label class="visually-hidden" [for]="'q-' + si + '-' + qi">Question {{ qi + 1 }}</label>
                    <textarea class="form-control q-text" rows="2" maxlength="500" placeholder="Question" [id]="'q-' + si + '-' + qi" [(ngModel)]="q.question"></textarea>
                    <div class="esg-tools">
                      <button type="button" class="btn btn-default tool" title="Move up" [disabled]="qi === 0" (click)="move(s, qi, -1)" [attr.aria-label]="'Move question ' + (qi + 1) + ' up'">&uarr;</button>
                      <button type="button" class="btn btn-default tool" title="Move down" [disabled]="qi === s.questions.length - 1" (click)="move(s, qi, 1)" [attr.aria-label]="'Move question ' + (qi + 1) + ' down'">&darr;</button>
                      <button type="button" class="btn btn-outline-danger tool" title="Remove" [disabled]="s.questions.length === 1" (click)="remove(s, qi)" [attr.aria-label]="'Remove question ' + (qi + 1)">Remove</button>
                    </div>
                  </div>

                  <div class="q-body">
                    <div class="opt-row">
                      <label class="esg-sub" [for]="'o-' + si + '-' + qi">Options <small>(comma-separated)</small></label>
                      <input class="form-control" [id]="'o-' + si + '-' + qi" placeholder="Yes, No, Not Applicable" [(ngModel)]="q.optionsText" />
                      <div class="chips" aria-hidden="true">
                        @for (o of options(q.optionsText); track $index) { <span class="opt-chip">{{ o }}</span> }
                      </div>
                    </div>

                    <div class="follow-toggles">
                      <span class="esg-sub">Follow-up question</span>
                      @for (on of showOn; track on) {
                        <div class="form-check form-switch follow-switch">
                          <input class="form-check-input" type="checkbox" role="switch" [id]="'f-' + on + si + '-' + qi" [checked]="!!follow(q, on)" (change)="toggle(q, on)" />
                          <label class="form-check-label" [for]="'f-' + on + si + '-' + qi">When the answer is {{ on }}</label>
                        </div>
                      }
                    </div>

                    @for (on of showOn; track on) {
                      @if (follow(q, on); as f) {
                        <div class="esg-follow" [class.on-no]="on === 'No'">
                          <span class="branch">If the answer is {{ on }}</span>
                          <div class="follow-grid">
                            <input class="form-control" maxlength="500" placeholder="Follow-up question" [attr.aria-label]="'Follow-up on ' + on" [(ngModel)]="f.question" />
                            <select class="form-select" [attr.aria-label]="'Answer type of the follow-up on ' + on" [(ngModel)]="f.type">
                              <option value="single_choice">Single choice</option>
                              <option value="text_box">Text</option>
                            </select>
                            @if (f.type === 'single_choice') {
                              <input class="form-control span-2" placeholder="Options, comma-separated" [attr.aria-label]="'Options of the follow-up on ' + on" [(ngModel)]="f.optionsText" />
                            } @else {
                              <small class="muted span-2">The unit types its answer.</small>
                            }
                          </div>
                        </div>
                      }
                    }
                  </div>
                </li>
              }
            </ol>
            <button type="button" class="btn btn-outline-primary btn-sm add-q" (click)="add(s)">+ Add question</button>
          </section>
        }
        <small class="text-muted d-block">Answers already given keep the questions as they were asked. The apps get a change the next time they open the checklist.</small>
        <div class="save-bar" [class.is-dirty]="dirty()">
          @if (dirty()) { <span class="unsaved me-auto">Not saved yet.</span> } @else { <span class="muted me-auto">All changes saved.</span> }
          @if (customised()) { <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="reset()">Reset to standard</button> }
          <button type="button" class="btn btn-primary" [disabled]="busy() || !dirty()" (click)="save()">Save</button>
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
    .esg-tab { display: inline-flex; align-items: center; gap: 8px; padding: 7px 18px; border-radius: 20px; border: 1px solid #cbd9da;
      background: #fff; color: #2f7c83; font-weight: 600; font-size: 14px; cursor: pointer; }
    .esg-tab:hover { background: #eef6f6; border-color: #45a5ad; }
    .esg-tab.active { background: #45a5ad; border-color: #45a5ad; color: #fff; }
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
    .esg-tools .tool { padding: 4px 10px; font-size: 13px; border-radius: 6px; text-transform: none; }
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
    .branch { display: inline-block; font-size: 12px; font-weight: 700; color: #2f7c83; margin-bottom: 6px; }
    .on-no .branch { color: #8a5a12; }
    .follow-grid { display: grid; grid-template-columns: minmax(0, 1fr) 160px; gap: 8px; align-items: center; }
    .follow-grid .span-2 { grid-column: 1 / -1; }
    .add-q { margin-top: 2px; }

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
  private static readonly url = '/api/staff/settings/esg-checklist';

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
    s.questions.push({ id: null, question: '', optionsText: 'Yes, No, Not Applicable', yes: null, no: null });
    this.changed();
  }

  protected remove(s: SectionDraft, index: number): void {
    if (!confirm(`Remove question ${index + 1}? Answers already given keep it.`)) return;
    s.questions.splice(index, 1);
    this.changed();
  }

  protected move(s: SectionDraft, index: number, by: number): void {
    const [q] = s.questions.splice(index, 1);
    s.questions.splice(index + by, 0, q);
    this.changed();
  }

  protected async save(): Promise<void> {
    await this.send(() => this.http.put<MessageResponse>(EsgChecklistPage.url, { sections: this.sections().map(toSection) }));
  }

  protected async reset(): Promise<void> {
    if (!confirm('Use the standard ESG checklist again? Your questions are removed.')) return;
    await this.send(() => this.http.delete<MessageResponse>(EsgChecklistPage.url));
  }

  private changed(): void {
    this.sections.set([...this.sections()]);
    this.dirty.set(true);
  }

  private async send(call: () => Observable<MessageResponse>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(call());
      await this.load(false);
      this.success.set(r.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    try {
      const r = await firstValueFrom(this.http.get<EsgChecklistResponse>(EsgChecklistPage.url));
      this.sections.set(r.checklist.sections.map(toDraft));
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
}

const splitOptions = (text: string): string[] => text.split(',').map((o) => o.trim()).filter((o) => o.length > 0);

function toDraft(s: EsgSection): SectionDraft {
  const follow = (q: EsgQuestion, on: 'Yes' | 'No'): FollowUpDraft | null => {
    const f = q.followUps.find((x) => x.showOn === on);
    return f ? { id: f.id, question: f.question, type: f.type, optionsText: f.options.join(', ') } : null;
  };
  return {
    title: s.title,
    questions: s.questions.map((q) => ({ id: q.id, question: q.question, optionsText: q.options.join(', '), yes: follow(q, 'Yes'), no: follow(q, 'No') })),
  };
}

function toSection(s: SectionDraft): EsgSection {
  return {
    title: s.title,
    questions: s.questions.map((q) => ({
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
