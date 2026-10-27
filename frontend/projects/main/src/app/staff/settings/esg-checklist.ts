import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
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
 * apps send them as two lists). A question keeps its code when edited; answers already given keep their texts.
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
        <span class="status-badge" [class.is-active]="customised()">
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
      <div (input)="dirty.set(true)" (change)="dirty.set(true)">
        @for (s of sections(); track $index; let si = $index) {
          <section class="zed-card esg-section" [attr.aria-label]="s.title">
            <label class="form-label" [for]="'esg-title-' + si">Section {{ si + 1 }} title</label>
            <input class="form-control esg-title" [id]="'esg-title-' + si" maxlength="100" [(ngModel)]="s.title" />
            <ol class="esg-list">
              @for (q of s.questions; track q; let qi = $index) {
                <li class="esg-q">
                  <div class="esg-row">
                    <span class="esg-no">{{ qi + 1 }}</span>
                    <div class="esg-main">
                      <label class="visually-hidden" [for]="'q-' + si + '-' + qi">Question {{ qi + 1 }}</label>
                      <textarea class="form-control" rows="2" maxlength="500" [id]="'q-' + si + '-' + qi" [(ngModel)]="q.question"></textarea>
                      <label class="form-label esg-sub" [for]="'o-' + si + '-' + qi">Options (comma-separated)</label>
                      <input class="form-control" [id]="'o-' + si + '-' + qi" [(ngModel)]="q.optionsText" />
                      @for (on of showOn; track on) {
                        <div class="form-check mt-2">
                          <input class="form-check-input" type="checkbox" [id]="'f-' + on + si + '-' + qi" [checked]="!!follow(q, on)" (change)="toggle(q, on)" />
                          <label class="form-check-label" [for]="'f-' + on + si + '-' + qi">Ask a follow-up question when the answer is {{ on }}</label>
                        </div>
                        @if (follow(q, on); as f) {
                          <div class="esg-follow">
                            <input class="form-control" maxlength="500" placeholder="Follow-up question" [attr.aria-label]="'Follow-up on ' + on" [(ngModel)]="f.question" />
                            <select class="form-select" [attr.aria-label]="'Answer type of the follow-up on ' + on" [(ngModel)]="f.type">
                              <option value="single_choice">Single choice</option>
                              <option value="text_box">Text</option>
                            </select>
                            @if (f.type === 'single_choice') {
                              <input class="form-control" placeholder="Options, comma-separated" [attr.aria-label]="'Options of the follow-up on ' + on" [(ngModel)]="f.optionsText" />
                            }
                          </div>
                        }
                      }
                    </div>
                    <div class="esg-tools">
                      <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="qi === 0" (click)="move(s, qi, -1)" [attr.aria-label]="'Move question ' + (qi + 1) + ' up'">&uarr;</button>
                      <button type="button" class="btn btn-sm btn-outline-secondary" [disabled]="qi === s.questions.length - 1" (click)="move(s, qi, 1)" [attr.aria-label]="'Move question ' + (qi + 1) + ' down'">&darr;</button>
                      <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="s.questions.length === 1" (click)="remove(s, qi)" [attr.aria-label]="'Remove question ' + (qi + 1)">Remove</button>
                    </div>
                  </div>
                </li>
              }
            </ol>
            <button type="button" class="btn btn-outline-primary btn-sm" (click)="add(s)">+ Add question</button>
          </section>
        }
        <small class="text-muted d-block">Answers already given keep the questions as they were asked. The apps get a change the next time they open the checklist.</small>
        <div class="form-actions">
          @if (dirty()) { <span class="muted me-auto">Not saved yet.</span> }
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
    .esg-section { margin-bottom: 16px; }
    .esg-title { font-weight: 700; max-width: 420px; }
    .esg-list { list-style: none; padding: 0; margin: 12px 0; }
    .esg-q + .esg-q { border-top: 1px solid #eef3f3; }
    .esg-row { display: flex; gap: 12px; padding: 12px 0; }
    .esg-no { flex: none; width: 28px; height: 28px; border-radius: 50%; background: #eef6f6; color: #2f7c83; font-weight: 700; display: grid; place-items: center; }
    .esg-main { flex: 1; min-width: 0; }
    .esg-sub { margin: 8px 0 4px; font-size: 13px; color: #5f6f70; }
    .esg-follow { display: grid; grid-template-columns: 1fr 150px; gap: 8px; margin: 6px 0 0 24px; }
    .esg-follow input:last-child:not(:first-child) { grid-column: 1 / -1; }
    .esg-tools { display: flex; flex-direction: column; gap: 6px; flex: none; }
    .form-actions { align-items: center; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 600px) { .esg-row { flex-wrap: wrap; } .esg-tools { flex-direction: row; } .esg-follow { grid-template-columns: 1fr; margin-left: 0; } }
  `,
})
export class EsgChecklistPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/esg-checklist';

  protected readonly showOn = SHOW_ON;
  protected readonly sections = signal<SectionDraft[]>([]);
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
