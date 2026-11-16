import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { withApiBase } from '../../api-base';

/** One answer to check (Zed.Core.Forms.AppFormCheckItem). */
export interface FormCheckItem {
  form: string;
  formName: string;
  key: string;
  label: string;
  type: string;
  /** The answer as text (several choices joined with ", "). */
  value: string;
  /** "Yes" (Valid) / "No" (Not valid) in this round; null: not checked yet. */
  status: string | null;
  remarks: string | null;
  /** NC round: the round raised in, the answer found not valid and the remark that raised it. */
  ncRound: number | null;
  previousValue: string | null;
  ncRemarks: string | null;
  answered: boolean;
}

export interface FormChecks {
  /** This page checks the level's answers (desktop: Bronze; the lead assessor's review: levels with a visit). */
  applies: boolean;
  canCheck: boolean;
  round: number;
  ncRound: boolean;
  items: FormCheckItem[];
}

/** Where the checks are: the desktop page or the lead assessor's review of a unit and level. */
export type FormChecksKind = 'desktop' | 'remote' | 'agency';

export function formChecksUrl(kind: FormChecksKind, zedId: string, certification: string): string {
  const unit = `${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`;
  // 2026-11-16: 'agency': the site assessor's own form, checked by the agency on its site review.
  return withApiBase(kind === 'desktop' ? `/api/staff/assessment/da/${unit}/form-checks`
    : kind === 'agency' ? `/api/staff/monitoring/review/${unit}/form-checks` : `/api/staff/remote/${unit}/form-checks`);
}

/**
 * "Basic Information · to validate" (Admin → App Forms → Validation required, migration 0080): each answer the assessor
 * checks, ✓ Valid or ✕ Not valid with a remark (Not valid raises an NC on the field at the final submit). In an NC round,
 * the answers whose NC was raised, with the remark and the answer found not valid. Shows nothing when the page does not
 * check this level's answers or there are none.
 */
@Component({
  selector: 'zed-form-checks',
  imports: [FormsModule],
  template: `
    @if (data(); as d) {
      @if (d.applies && d.items.length) {
        <div class="card mb-3 form-checks" data-testid="form-checks">
          <div class="card-header d-flex justify-content-between">
            <strong>{{ d.items[0].formName }} · to validate</strong>
            <small class="text-muted">{{ checked() }} of {{ d.items.length }} checked</small>
          </div>
          <div class="card-body py-2">
            @if (d.ncRound) { <p class="small text-muted mb-2">NC {{ d.round }}: the unit's new answers to the fields found not valid.</p> }
            @if (kind() === 'agency') { <p class="small text-muted mb-2" data-agency-note>The site assessor's answers. Not valid sends the answer back to the site assessor, who corrects it in the assessor app; final submit once every answer is Valid.</p> }
            @if (error()) { <div class="alert alert-danger py-1 small mb-2" role="alert">{{ error() }}</div> }
            @for (i of d.items; track i.form + i.key) {
              <div class="fc-row" [attr.data-key]="i.key">
                <div class="fc-head">
                  <div>
                    <div class="small text-muted">{{ i.label }}</div>
                    <div class="fc-value">{{ i.value || '—' }}</div>
                    @if (i.ncRound) {
                      <div class="small text-muted">Earlier answer: {{ i.previousValue || '—' }} · Remark: {{ i.ncRemarks }}</div>
                      @if (!i.answered) { <div class="small text-danger">The unit has not answered this NC.</div> }
                    }
                  </div>
                  @if (d.canCheck) {
                    <div class="btn-group btn-group-sm fc-buttons" role="group" [attr.aria-label]="'Check ' + i.label">
                      <button type="button" class="btn" [class.btn-success]="i.status === 'Yes'" [class.btn-outline-success]="i.status !== 'Yes'"
                              [disabled]="busy()" (click)="valid(i)">✓ Valid</button>
                      <button type="button" class="btn" [class.btn-danger]="isNotValid(i)" [class.btn-outline-danger]="!isNotValid(i)"
                              [disabled]="busy()" (click)="notValid(i)">✕ Not valid</button>
                    </div>
                  } @else {
                    <span class="badge" [class.text-bg-success]="i.status === 'Yes'" [class.text-bg-danger]="i.status === 'No'"
                          [class.text-bg-secondary]="!i.status">{{ i.status === 'Yes' ? 'Valid' : i.status === 'No' ? 'Not valid' : 'Not checked' }}</span>
                  }
                </div>
                @if (editing() === i.form + i.key) {
                  <div class="fc-remark">
                    <input class="form-control form-control-sm" maxlength="1000" [placeholder]="kind() === 'agency' ? 'Why the answer is not valid (sent back to the site assessor)' : 'Why the answer is not valid (raises an NC)'"
                           [attr.aria-label]="'Remark on ' + i.label" [(ngModel)]="remark" />
                    <button type="button" class="btn btn-sm btn-danger" [disabled]="busy()" (click)="saveNotValid(i)">Save</button>
                    <button type="button" class="btn btn-sm btn-link" (click)="editing.set(null)">Cancel</button>
                  </div>
                } @else if (i.status === 'No' && i.remarks) {
                  <div class="small text-danger">Remark: {{ i.remarks }}</div>
                }
              </div>
            }
          </div>
        </div>
      }
    }
  `,
  styles: `
    .fc-row { border-top: 1px solid var(--bs-border-color); padding: 8px 0; }
    .fc-row:first-of-type { border-top: 0; }
    .fc-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
    .fc-value { white-space: pre-wrap; word-break: break-word; }
    .fc-remark { display: flex; gap: 6px; margin-top: 6px; }
  `,
})
export class FormChecksPanel {
  private readonly http = inject(HttpClient);

  readonly kind = input.required<FormChecksKind>();
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();
  /** A check was saved (the page may refresh its final-submit state). */
  readonly changed = output<void>();

  protected readonly data = signal<FormChecks | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected remark = '';
  protected readonly checked = computed(() => (this.data()?.items ?? []).filter((i) => i.status).length);

  private url = '';

  constructor() {
    effect(() => {
      this.url = formChecksUrl(this.kind(), this.zedId(), this.certification());
      untracked(() => void this.load());
    });
  }

  protected isNotValid(i: FormCheckItem): boolean {
    return i.status === 'No' || this.editing() === i.form + i.key;
  }

  protected valid(i: FormCheckItem): void {
    this.editing.set(null);
    void this.save(i, 'Yes', null);
  }

  protected notValid(i: FormCheckItem): void {
    this.remark = i.status === 'No' ? (i.remarks ?? '') : '';
    this.editing.set(i.form + i.key);
  }

  protected saveNotValid(i: FormCheckItem): void {
    if (!this.remark.trim()) {
      this.error.set('Please enter a remark: why the answer is not valid.');
      return;
    }
    void this.save(i, 'No', this.remark.trim());
  }

  private async save(i: FormCheckItem, status: 'Yes' | 'No', remarks: string | null): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.http.post(this.url, { form: i.form, key: i.key, status, remarks }));
      this.editing.set(null);
      await this.load();
      this.changed.emit();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.http.get<FormChecks>(this.url)));
    } catch {
      // Optional panel: nothing to check, or not visible to this user.
      this.data.set(null);
    }
  }
}
