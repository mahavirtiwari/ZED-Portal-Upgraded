import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';

/** Who answers: the desktop assessor, the lead site assessor, or the handholding consultant (baseline, progress reviews). */
export type CheckpointStage = 'Desktop' | 'Site' | 'Baseline' | 'Review1' | 'Review2';
export type CheckpointValue = 'Yes' | 'Partial' | 'No';

export interface CheckpointEvidence {
  id: number;
  name: string;
  mandatory: boolean;
  /** The unit sent its file. */
  uploaded: boolean;
  /** The assessor's Yes / No, when validated. */
  verified: string | null;
}

export interface CheckpointAnswer {
  value: CheckpointValue;
  actions: string[];
  remarks: string | null;
}

/** A checkpoint of a unit's requirement row (CheckpointAnswers.Checkpoint, migration 0039). */
export interface Checkpoint {
  /** MsmeOptions.Id. */
  id: number;
  /** MsmeRequirements.Id. */
  requirementId: number;
  optionCode: string;
  text: string;
  /** The Admin's actions needed for No / Partial. */
  actions: string[];
  evidences: CheckpointEvidence[];
  desktop: CheckpointAnswer | null;
  site: CheckpointAnswer | null;
  baseline: CheckpointAnswer | null;
  review1: CheckpointValue | null;
  review2: CheckpointValue | null;
}

export interface CheckpointSaveRequest {
  answers: { id: number; answer: CheckpointValue; actions: string[]; remarks: string | null }[];
  remarks: string | null;
}

/** The checkpoints of one requirement row. */
export function checkpointsOf(all: readonly Checkpoint[] | undefined, requirementId: unknown): Checkpoint[] {
  return (all ?? []).filter((c) => String(c.requirementId) === String(requirementId));
}

/** The answer given at a stage. */
export function answerAt(c: Checkpoint, stage: CheckpointStage): CheckpointValue | null {
  switch (stage) {
    case 'Desktop': return c.desktop?.value ?? null;
    case 'Site': return c.site?.value ?? null;
    case 'Baseline': return c.baseline?.value ?? null;
    case 'Review1': return c.review1;
    default: return c.review2;
  }
}

interface Edit {
  answer: CheckpointValue | null;
  actions: string[];
  remarks: string;
}

/** The answer chips the pages show beside a checkpoint (class cp-chip, data-v the answer). */
export const CHECKPOINT_CHIP_STYLES = `
  .cp-chip { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 10px; padding: 0 7px; margin-left: 6px; vertical-align: 1px; }
  .cp-chip[data-v='Yes'] { background: #e6f6ec; color: #1e7a3c; }
  .cp-chip[data-v='Partial'] { background: #fff4d6; color: #8a6100; }
  .cp-chip[data-v='No'] { background: #fdeef0; color: #a8303a; }
`;

const VALUES: readonly CheckpointValue[] = ['Yes', 'Partial', 'No'];

const TITLES: Record<CheckpointStage, string> = {
  Desktop: 'Desktop assessment',
  Site: 'Site assessment',
  Baseline: 'Baseline',
  Review1: 'Progress Review 1',
  Review2: 'Progress Review 2',
};

/**
 * Yes / Partial / No for each checkpoint of a requirement (desktop assessment, remote / site assessment, handholding):
 * for Yes the checkpoint's evidence, for No / Partial the Admin's actions needed to tick. The requirement is conforming only
 * when every checkpoint is Yes. The same rules are checked again on the server (CheckpointAnswers.Decide).
 */
@Component({
  selector: 'zed-checkpoint-dialog',
  template: `
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
      <div class="modal-dialog modal-lg cp-dialog">
        <div class="modal-content">
          <div class="modal-header justify-content-between">
            <div>
              <h5 class="modal-title" id="cpTitle">Checkpoints · {{ stageTitle() }}</h5>
              <small class="cp-sub">{{ title() }}</small>
            </div>
            <button type="button" class="btn-close" aria-label="Close" (click)="closed.emit()"></button>
          </div>
          <div class="modal-body">
            @for (c of checkpoints(); track c.id; let i = $index) {
              @let e = edits()[i];
              <section class="cp" [attr.data-checkpoint]="c.optionCode">
                <div class="cp-top">
                  <div class="cp-q"><b>{{ c.optionCode }}.</b> {{ c.text }}</div>
                  <div class="cp-seg" role="radiogroup" [attr.aria-label]="'Answer of checkpoint ' + c.optionCode">
                    @for (v of values; track v) {
                      <label class="cp-opt" [class.on]="e?.answer === v" [attr.data-v]="v">
                        <input type="radio" [name]="'cp' + c.id" [value]="v" [checked]="e?.answer === v" (change)="set(i, { answer: v })" />{{ v }}
                      </label>
                    }
                  </div>
                </div>
                @for (p of prior(c); track p.label) {
                  <div class="cp-prior">{{ p.label }}: <span class="cp-chip" [attr.data-v]="p.value">{{ p.value }}</span></div>
                }
                @if (c.evidences.length) {
                  <div class="cp-box ev">
                    <h6>{{ handholding() ? 'Evidence to see (for Yes)' : 'Evidence (for Yes)' }}</h6>
                    @for (ev of c.evidences; track ev.id) {
                      <div class="cp-line">
                        <span class="cp-tag" [class.m]="ev.mandatory">{{ ev.mandatory ? 'Mandatory' : 'Optional' }}</span>
                        <span>{{ ev.name }}</span>
                        @if (!handholding()) {
                          <span class="cp-state" [class.bad]="!ev.uploaded || ev.verified === 'No'">
                            {{ !ev.uploaded ? 'not uploaded' : ev.verified === 'Yes' ? 'verified' : ev.verified === 'No' ? 'not verified' : 'uploaded' }}
                          </span>
                        }
                      </div>
                    }
                  </div>
                }
                @if (e && (e.answer === 'No' || e.answer === 'Partial')) {
                  @if (!review()) {
                    <div class="cp-box act">
                      @if (c.actions.length) {
                        <h6>Actions needed – tick the ones that apply</h6>
                        @for (a of c.actions; track a) {
                          <label class="cp-line cp-check">
                            <input type="checkbox" [checked]="e.actions.includes(a)" (change)="toggle(i, a)" /> {{ a }}
                          </label>
                        }
                      }
                      <textarea class="form-control cp-remark" rows="2" maxlength="1000" [attr.aria-label]="'Remark on checkpoint ' + c.optionCode"
                        [placeholder]="c.actions.length ? 'Remark (optional)' : 'What is needed (required)'" [value]="e.remarks" (input)="remark(i, $event)"></textarea>
                    </div>
                  }
                }
              </section>
            }
            @if (!handholding()) {
              <div class="cp-result" [class.ok]="conforming()" [hidden]="!allAnswered()">
                Requirement result: <b>{{ conforming() ? 'Conforming' : 'Not conforming' }}</b>
                <small>{{ counts() }}</small>
              </div>
              <label class="cp-label" for="cpRemarks">Remarks for the unit</label>
              <textarea id="cpRemarks" class="form-control" rows="3" maxlength="2000" [value]="remarks()" (input)="remarks.set(value($event))"
                placeholder="Optional. If empty and not conforming, the actions ticked are written as the remarks."></textarea>
            }
            @if (problem() || error()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ problem() || error() }}</div> }
          </div>
          <div class="modal-footer">
            <input type="button" class="btn btn-default" value="CANCEL" (click)="closed.emit()" />
            <input type="button" class="btn btn-primary" value="SUBMIT" [disabled]="busy()" (click)="submit()" />
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop show"></div>
  `,
  styles: `
    .modal > .modal-dialog.cp-dialog { max-width: 860px; width: calc(100% - 32px); }
    .cp-sub { color: #5f6f70; }
    .cp { border-bottom: 1px solid #eef3f3; padding: 12px 0; }
    .cp:first-child { padding-top: 0; }
    .cp-top { display: flex; gap: 14px; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
    .cp-q { color: #23474a; font-weight: 600; flex: 1 1 320px; }
    .cp-seg { display: inline-flex; border: 1.5px solid #45a5ad; border-radius: 9px; overflow: hidden; flex: none; }
    .cp-opt { margin: 0; padding: 5px 13px; font-weight: 700; font-size: 13px; color: #2f7c83; background: #fff; cursor: pointer; border-right: 1.5px solid #45a5ad; }
    .cp-opt:last-child { border-right: 0; }
    .cp-opt input { position: absolute; opacity: 0; width: 0; height: 0; }
    .cp-opt:focus-within { outline: 2px solid #2f7c83; outline-offset: -3px; }
    .cp-opt.on[data-v='Yes'] { background: #2e9e5b; color: #fff; }
    .cp-opt.on[data-v='Partial'] { background: #b88a00; color: #fff; }
    .cp-opt.on[data-v='No'] { background: #a8303a; color: #fff; }
    .cp-prior { font-size: 12px; color: #5f6f70; margin-top: 4px; }
    .cp-chip { font-size: 11.5px; font-weight: 700; border-radius: 10px; padding: 1px 8px; }
    .cp-chip[data-v='Yes'] { background: #e6f6ec; color: #1e7a3c; }
    .cp-chip[data-v='Partial'] { background: #fff4d6; color: #8a6100; }
    .cp-chip[data-v='No'] { background: #fdeef0; color: #a8303a; }
    .cp-box { margin-top: 8px; border-radius: 10px; padding: 8px 10px; font-size: 13px; }
    .cp-box.ev { background: #f6fbf8; border: 1px solid #d4eedd; }
    .cp-box.act { background: #fffaf0; border: 1px solid #f1e0b0; }
    .cp-box h6 { margin: 0 0 5px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: #5f6f70; }
    .cp-line { display: flex; align-items: center; gap: 8px; padding: 2px 0; flex-wrap: wrap; }
    .modal .cp-check { font-weight: 400; margin: 0; cursor: pointer; }
    .cp-tag { font-size: 11px; font-weight: 700; border-radius: 10px; padding: 1px 8px; background: #f2f4f4; color: #5f6f70; }
    .cp-tag.m { background: #f1f0fb; color: #3f3a7a; }
    .cp-state { font-size: 12px; color: #1e7a3c; }
    .cp-state.bad { color: #a8303a; }
    .modal .cp-remark { min-height: 0; height: auto; margin-top: 6px; font-size: 13px; }
    .modal .cp-dialog textarea.form-control { min-height: 0; height: auto; }
    .cp-result { margin: 12px 0; border-radius: 10px; padding: 8px 12px; background: #fdeef0; color: #a8303a; display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; }
    .cp-result.ok { background: #e6f6ec; color: #1e7a3c; }
    .cp-result small { color: inherit; opacity: .85; }
    .cp-label { display: block; margin-top: 4px; }
  `,
})
export class CheckpointDialog {
  readonly title = input('');
  readonly checkpoints = input.required<Checkpoint[]>();
  readonly stage = input.required<CheckpointStage>();
  readonly busy = input(false);
  /** The server's answer to the last submit. */
  readonly error = input('');
  readonly saved = output<CheckpointSaveRequest>();
  readonly closed = output<void>();

  protected readonly values = VALUES;
  protected readonly edits = signal<Edit[]>([]);
  protected readonly remarks = signal('');
  protected readonly problem = signal('');
  protected readonly stageTitle = computed(() => TITLES[this.stage()]);
  protected readonly handholding = computed(() => ['Baseline', 'Review1', 'Review2'].includes(this.stage()));
  protected readonly review = computed(() => this.stage() === 'Review1' || this.stage() === 'Review2');
  protected readonly allAnswered = computed(() => this.edits().length > 0 && this.edits().every((e) => e.answer));
  protected readonly conforming = computed(() => this.edits().every((e) => e.answer === 'Yes'));
  protected readonly counts = computed(() =>
    VALUES.map((v) => [v, this.edits().filter((e) => e.answer === v).length] as const).filter(([, n]) => n > 0).map(([v, n]) => `${n} ${v}`).join(' · '));

  constructor() {
    // Each checkpoint starts with the answer already given at this stage.
    effect(() => {
      const stage = this.stage();
      const list = this.checkpoints();
      untracked(() => this.edits.set(list.map((c) => {
        const own = stage === 'Desktop' ? c.desktop : stage === 'Site' ? c.site : stage === 'Baseline' ? c.baseline : null;
        return { answer: answerAt(c, stage), actions: [...(own?.actions ?? [])], remarks: own?.remarks ?? '' };
      })));
    });
  }

  /** The answers given before this stage, for reference. */
  protected prior(c: Checkpoint): { label: string; value: CheckpointValue }[] {
    const stage = this.stage();
    const list: { label: string; value: CheckpointValue | null | undefined }[] =
      stage === 'Site' ? [{ label: 'Desktop assessor', value: c.desktop?.value }]
        : stage === 'Review1' ? [{ label: 'Baseline', value: c.baseline?.value }]
          : stage === 'Review2' ? [{ label: 'Baseline', value: c.baseline?.value }, { label: 'Progress Review 1', value: c.review1 }]
            : [];
    return list.filter((p): p is { label: string; value: CheckpointValue } => !!p.value);
  }

  protected set(i: number, change: Partial<Edit>): void {
    this.problem.set('');
    this.edits.update((list) => list.map((e, j) => (j === i ? { ...e, ...change } : e)));
  }

  protected toggle(i: number, action: string): void {
    const e = this.edits()[i];
    this.set(i, { actions: e.actions.includes(action) ? e.actions.filter((a) => a !== action) : [...e.actions, action] });
  }

  protected remark(i: number, event: Event): void {
    this.set(i, { remarks: this.value(event) });
  }

  protected value(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected submit(): void {
    const problem = this.check();
    this.problem.set(problem);
    if (problem) return;
    const review = this.review();
    this.saved.emit({
      answers: this.checkpoints().map((c, i) => {
        const e = this.edits()[i];
        const open = e.answer !== 'Yes' && !review;
        return { id: c.id, answer: e.answer!, actions: open ? c.actions.filter((a) => e.actions.includes(a)) : [], remarks: e.remarks.trim() || null };
      }),
      remarks: this.handholding() ? null : this.remarks().trim() || null,
    });
  }

  /** As CheckpointAnswers.Decide, so most mistakes show before saving (the photo rule of handholding is the server's). */
  private check(): string {
    const assessment = !this.handholding();
    for (const [i, c] of this.checkpoints().entries()) {
      const e = this.edits()[i];
      const name = `Checkpoint ${c.optionCode}`;
      if (!e?.answer) return `${name}: please choose Yes, Partial or No.`;
      if (e.answer === 'Yes' && assessment) {
        const missing = c.evidences.find((ev) => ev.mandatory && !ev.uploaded);
        if (missing) return `${name}: Yes needs every mandatory evidence; "${missing.name}" is not uploaded.`;
        const refused = c.evidences.find((ev) => ev.mandatory && ev.verified === 'No');
        if (refused) return `${name}: Yes needs every mandatory evidence; "${refused.name}" was not verified.`;
      }
      if (e.answer !== 'Yes' && !this.review()) {
        if (c.actions.length && !c.actions.some((a) => e.actions.includes(a))) return `${name}: please tick the actions needed.`;
        if (!c.actions.length && !e.remarks.trim()) return `${name}: please write what is needed.`;
      }
    }
    return '';
  }
}
