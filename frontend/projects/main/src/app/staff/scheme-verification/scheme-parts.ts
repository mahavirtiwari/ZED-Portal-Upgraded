import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TextPipe } from '../../content/page-text';
import { day, money, statusLabel, statusTone } from './scheme-shared';
import { SchemeDetail, SchemeField, SchemeSection } from './scheme-verification.api';

/** An assessor's mark not yet saved. */
export interface CheckEdit {
  status: 'Yes' | 'No';
  remarks: string;
}

/**
 * The facts of a scheme application (unit, scheme, level, certificate, agency, assessor, status, bank account), its totals
 * (claimed / verified / eligible) and its history, as the staff pages show them.
 */
@Component({
  selector: 'zed-scheme-summary',
  imports: [TextPipe],
  template: `
    @let a = detail().application;
    <div class="zed-card ss">
      <div class="ss-head">
        <div>
          <h3 class="m-0">{{ a.unitName || a.zedId }}</h3>
          <small>{{ a.zedId }}@if (a.unitAddress) { · {{ a.unitAddress }} }</small>
        </div>
        <span [class]="'chip ' + statusTone(a.status)">{{ statusLabel(a.status) }}</span>
      </div>
      <dl class="ss-facts">
        <div><dt>{{ 'Scheme' | t: 'staff.schemeVerification.detail.scheme' }}</dt><dd>{{ a.schemeName }}</dd></div>
        <div><dt>{{ 'Claim for' | t: 'staff.schemeVerification.detail.level' }}</dt><dd>{{ a.levelName || '–' }}@if (a.certNo) { · {{ a.certNo }} }</dd></div>
        <div><dt>{{ 'Submitted on' | t: 'staff.schemeVerification.detail.submitted' }}</dt><dd>{{ day(a.submittedOn) || '–' }}</dd></div>
        <div><dt>{{ 'Agency' | t: 'staff.schemeVerification.detail.agency' }}</dt><dd>{{ a.agency ? (a.agency.name || a.agency.userId) + ' (' + a.agency.userId + ')' : '–' }}</dd></div>
        <div><dt>{{ 'Assessor' | t: 'staff.schemeVerification.detail.assessor' }}</dt><dd>{{ a.assessor ? (a.assessor.name || a.assessor.userId) + ' (' + a.assessor.userId + ')' : '–' }}</dd></div>
        <div><dt>{{ 'Correction rounds' | t: 'staff.schemeVerification.detail.rounds' }}</dt>
          <dd>{{ '{used} of {total}' | t: 'staff.schemeVerification.detail.roundsValue' : { used: a.correctionRound, total: a.correctionRounds } }}@if (a.status === 'Correction' && a.correctionDueOn) { · {{ 'due {due}' | t: 'staff.schemeVerification.detail.due' : { due: day(a.correctionDueOn) } }} }</dd></div>
        @if (a.accountNo) {
          <div><dt>{{ 'Bank account' | t: 'staff.schemeVerification.detail.bank' }}</dt><dd>{{ a.accountNo }} · {{ a.ifscCode }} · {{ a.bankName }}@if (a.branchAddress) { · {{ a.branchAddress }} }</dd></div>
        }
      </dl>
      @if (a.holdReason) { <div class="alert alert-warning mb-2" role="status">{{ 'On hold: {reason}' | t: 'staff.schemeVerification.detail.hold' : { reason: a.holdReason } }}</div> }
      @if (a.reasonForRejection) { <div class="alert alert-danger mb-2" role="status">{{ 'Reason for rejection: {reason}' | t: 'staff.schemeVerification.detail.rejected' : { reason: a.reasonForRejection } }}</div> }
      @if (a.agencyRemarks) { <div class="alert alert-info mb-2" role="status">{{ a.agencyRemarks }}</div> }
      <div class="ss-totals" role="list">
        <div role="listitem"><small>{{ 'Claimed' | t: 'staff.schemeVerification.totals.claimed' }}</small><b data-total="claimed">Rs. {{ money(detail().totals.claimed) }}</b></div>
        <div role="listitem"><small>{{ 'Verified' | t: 'staff.schemeVerification.totals.verified' }}</small><b data-total="verified">Rs. {{ money(detail().totals.verified) }}</b></div>
        <div role="listitem"><small>{{ 'Eligible' | t: 'staff.schemeVerification.totals.eligible' }}@if (detail().totals.sharePercent !== null) { ({{ detail().totals.sharePercent }}%, {{ 'max' | t: 'staff.schemeVerification.totals.max' }} Rs. {{ money(detail().totals.maxAmount) }}) }</small><b data-total="eligible">Rs. {{ money(detail().totals.eligible) }}</b></div>
        @if (a.approvedAmount !== null) {
          <div role="listitem"><small>{{ 'Approved' | t: 'staff.schemeVerification.totals.approved' }}</small><b>Rs. {{ money(a.approvedAmount) }}</b></div>
        }
      </div>
    </div>
  `,
  styles: `
    .ss { padding: 18px 20px; margin-bottom: 16px; }
    .ss-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
    .ss-head h3 { font-size: 18px; }
    .ss-head small { color: #5f6f70; }
    .ss-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 20px; margin: 0 0 12px; }
    .ss-facts dt { font-size: 12px; color: #5f6f70; font-weight: 500; }
    .ss-facts dd { margin: 0; font-size: 13.5px; color: #17373b; }
    .ss-totals { display: flex; flex-wrap: wrap; gap: 12px; }
    .ss-totals > div { flex: 1 1 160px; border: 1px solid #dde7e8; border-radius: 10px; padding: 10px 14px; background: #f7fbfb; }
    .ss-totals small { display: block; font-size: 12px; color: #5f6f70; }
    .ss-totals b { font-size: 17px; color: #17373b; }
  `,
})
export class SchemeSummary {
  readonly detail = input.required<SchemeDetail>();
  protected readonly statusLabel = statusLabel;
  protected readonly statusTone = statusTone;
  protected readonly money = money;
  protected readonly day = day;
}

/**
 * The answers by section and item with their documents; for each answer or document the assessor checks, the check (Valid / Not
 * valid with the remark) — editable on the assessor's verification page (<code>editable</code>, the marks in <code>edits</code>).
 */
@Component({
  selector: 'zed-scheme-answers',
  imports: [FormsModule, TextPipe],
  template: `
    @for (s of sections(); track s.key) {
      <section class="zed-card sa" [attr.aria-labelledby]="'sa-' + s.key">
        <h4 [id]="'sa-' + s.key">{{ s.title }}</h4>
        @for (it of s.items; track it.index) {
          <div class="sa-item">
            @if (s.repeating) {
              <h5>{{ 'Item {n}' | t: 'staff.schemeVerification.answers.item' : { n: $index + 1 } }}@if (it.pickName || it.pick) { — {{ it.pickName || it.pick }} }</h5>
            }
            <table class="table sa-table">
              <tbody>
                @for (f of it.fields; track f.key) {
                  <tr [class.sa-no]="mark(f)?.status === 'No'">
                    <th scope="row">{{ f.label }}</th>
                    <td>
                      @if (f.files.length) {
                        @for (file of f.files; track file.name) {
                          <a class="sa-file" [href]="file.url" target="_blank" rel="noopener">{{ file.isPdf ? ('View PDF' | t: 'staff.schemeVerification.answers.pdf') : ('View image' | t: 'staff.schemeVerification.answers.image') }} {{ $index + 1 }}</a>
                        }
                      } @else if (f.type === 'amount' && f.value) {
                        Rs. {{ amount(f.value) }}
                      } @else {
                        <span class="sa-val">{{ f.value || '–' }}</span>
                      }
                    </td>
                    <td class="sa-check">
                      @if (f.path) {
                        @if (editable()) {
                          <div class="sa-radios" role="radiogroup" [attr.aria-label]="'Check of {label}' | t: 'staff.schemeVerification.answers.checkAria' : { label: f.label }">
                            <label><input type="radio" [name]="'c-' + f.path" value="Yes" [checked]="mark(f)?.status === 'Yes'" (change)="set(f, 'Yes')" /> {{ 'Valid' | t: 'staff.schemeVerification.answers.valid' }}</label>
                            <label><input type="radio" [name]="'c-' + f.path" value="No" [checked]="mark(f)?.status === 'No'" (change)="set(f, 'No')" /> {{ 'Not valid' | t: 'staff.schemeVerification.answers.notValid' }}</label>
                          </div>
                          @if (mark(f)?.status === 'No') {
                            <input type="text" class="form-control form-control-sm sa-remark" maxlength="1000" [attr.data-path]="f.path"
                                   [placeholder]="'What is not valid (the unit corrects it)' | t: 'staff.schemeVerification.answers.remarkPlaceholder'"
                                   [attr.aria-label]="'Remark for {label}' | t: 'staff.schemeVerification.answers.remarkAria' : { label: f.label }"
                                   [ngModel]="mark(f)?.remarks ?? ''" (ngModelChange)="remark(f, $event)" />
                          }
                        } @else if (f.check) {
                          <span [class]="'chip ' + (f.check.status === 'Yes' ? 'is-good' : 'is-bad')">{{ f.check.status === 'Yes' ? ('Valid' | t: 'staff.schemeVerification.answers.valid') : ('Not valid' | t: 'staff.schemeVerification.answers.notValid') }}</span>
                          @if (f.check.remarks) { <small class="d-block">{{ f.check.remarks }}</small> }
                        } @else {
                          <span class="sub">{{ 'Not checked' | t: 'staff.schemeVerification.answers.unchecked' }}</span>
                        }
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @empty {
          <p class="sub m-0">{{ 'No answers.' | t: 'staff.schemeVerification.answers.empty' }}</p>
        }
      </section>
    }
  `,
  styles: `
    .sa { padding: 16px 20px; margin-bottom: 16px; }
    .sa h4 { font-size: 16px; margin-bottom: 10px; }
    .sa h5 { font-size: 14px; color: #24666b; margin: 6px 0; }
    .sa-item + .sa-item { border-top: 1px dashed #dde7e8; padding-top: 8px; }
    .sa-table { margin: 0; font-size: 13px; }
    .sa-table th { width: 30%; font-weight: 500; color: #5f6f70; }
    .sa-check { width: 36%; }
    .sa-val { white-space: pre-wrap; }
    tr.sa-no > th { box-shadow: inset 3px 0 0 #d64532; }
    .sa-file { margin-right: 10px; }
    .sa-radios { display: flex; gap: 14px; }
    .sa-radios label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .sa-remark { margin-top: 6px; }
  `,
})
export class SchemeAnswers {
  readonly sections = input.required<SchemeSection[]>();
  readonly editable = input(false);
  /** The marks changed on the page, by path (not saved yet). */
  readonly edits = model<Record<string, CheckEdit>>({});

  protected mark(f: SchemeField): CheckEdit | null {
    const e = f.path ? this.edits()[f.path] : undefined;
    return e ?? (f.check ? { status: f.check.status, remarks: f.check.remarks ?? '' } : null);
  }

  protected set(f: SchemeField, status: 'Yes' | 'No'): void {
    if (!f.path) return;
    const now = this.mark(f);
    this.edits.set({ ...this.edits(), [f.path]: { status, remarks: status === 'No' ? (now?.remarks ?? '') : '' } });
  }

  protected remark(f: SchemeField, remarks: string): void {
    if (!f.path) return;
    this.edits.set({ ...this.edits(), [f.path]: { status: 'No', remarks: remarks ?? '' } });
  }

  protected amount(v: string): string {
    return money(Number(v));
  }
}
