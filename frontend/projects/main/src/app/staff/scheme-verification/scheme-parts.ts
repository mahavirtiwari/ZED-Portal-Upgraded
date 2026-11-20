import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TextPipe, t } from '../../content/page-text';
import { day, money, statusLabel, statusTone } from './scheme-shared';
import { SchemeDetail, SchemeField, SchemeOnsitePhoto, SchemeOnsiteReport, SchemeSection } from './scheme-verification.api';

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
      @if (a.holdReason && a.status === 'OnHold') { <div class="alert alert-warning mb-2" role="status">{{ 'On hold: {reason}' | t: 'staff.schemeVerification.detail.hold' : { reason: a.holdReason } }}</div> }
      @else if (a.holdReason) { <div class="alert alert-info mb-2" role="status">{{ 'Resumed by the Master Admin. It was on hold: {reason}' | t: 'staff.schemeVerification.detail.resumed' : { reason: resumedText(a.holdReason) } }}</div> }
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
  /** The stored "Resumed: …" marker (the sweep does not hold it again for the same certificate state) without its prefix. */
  protected resumedText(reason: string): string {
    return reason.startsWith('Resumed: ') ? reason.slice('Resumed: '.length) : reason;
  }
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
        <h4 [id]="'sa-' + s.key">{{ title(s) }}</h4>
        @for (it of s.items; track it.index) {
          <div class="sa-item">
            @if (s.repeating) {
              <h5>{{ 'Item {n}' | t: 'staff.schemeVerification.answers.item' : { n: $index + 1 } }}@if (it.pickName || it.pick) { — {{ it.pickName || it.pick }} }</h5>
            }
            <table class="table sa-table">
              <tbody>
                @for (f of it.fields; track f.key) {
                  <tr [class.sa-no]="mark(f)?.status === 'No'">
                    <th scope="row">{{ label(s, f) }}</th>
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
                          <div class="sa-radios" role="radiogroup" [attr.aria-label]="'Check of {label}' | t: 'staff.schemeVerification.answers.checkAria' : { label: label(s, f) }">
                            <label><input type="radio" [name]="'c-' + f.path" value="Yes" [checked]="mark(f)?.status === 'Yes'" (change)="set(f, 'Yes')" /> {{ 'Valid' | t: 'staff.schemeVerification.answers.valid' }}</label>
                            <label><input type="radio" [name]="'c-' + f.path" value="No" [checked]="mark(f)?.status === 'No'" (change)="set(f, 'No')" /> {{ 'Not valid' | t: 'staff.schemeVerification.answers.notValid' }}</label>
                          </div>
                          @if (mark(f)?.status === 'No') {
                            <input type="text" class="form-control form-control-sm sa-remark" maxlength="1000" [attr.data-path]="f.path"
                                   [placeholder]="'What is not valid (the unit corrects it)' | t: 'staff.schemeVerification.answers.remarkPlaceholder'"
                                   [attr.aria-label]="'Remark for {label}' | t: 'staff.schemeVerification.answers.remarkAria' : { label: label(s, f) }"
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

  /** The standard bank block (section "_bank") has fixed wording of its own; other sections show the scheme's titles. */
  protected title(s: SchemeSection): string {
    return s.key === BANK_SECTION ? t('staff.schemeVerification.answers.bankTitle', 'Bank account') : s.title;
  }

  /** 2026-11-20: the bank block's account details (number, IFSC, bank, branch) and cancelled cheque are checked like the answers. */
  protected label(s: SchemeSection, f: SchemeField): string {
    if (s.key !== BANK_SECTION) return f.label;
    if (f.key === 'account') return t('staff.schemeVerification.answers.bankAccount', 'Bank account details');
    if (f.key === 'cheque') return t('staff.schemeVerification.answers.cheque', 'Cancelled cheque');
    return f.label;
  }
}

/** The answers' key of the standard bank block (ApplicantForm.BankSection). */
const BANK_SECTION = '_bank';

/**
 * Phase 2 (2026-11-20): the onsite stage of a Desktop + Onsite application, as the Master Admin and the onsite agency (its final QC)
 * see it: the onsite agency and assessor, the date of verification (the day the visit started in the assessor app), the unit's
 * representative (shown in full on this signed-in page), where the visit started, the claim verified onsite and its eligible amount,
 * the photos (selfie, site, each item's), the answers checked at the visit and the assessor's remarks.
 */
@Component({
  selector: 'zed-scheme-onsite-report',
  imports: [TextPipe],
  template: `
    @let o = report();
    <section class="zed-card so" aria-labelledby="so-h">
      <h4 id="so-h">{{ 'Onsite verification' | t: 'staff.schemeVerification.onsite.title' }}</h4>
      <dl class="so-facts">
        <div><dt>{{ 'Onsite agency' | t: 'staff.schemeVerification.onsite.agency' }}</dt>
          <dd>@if (o.agency) { {{ (o.agency.name || o.agency.userId) + ' (' + o.agency.userId + ')' }}@if (o.allotmentType === 'RoundRobin') { <span class="zed-chip so-auto">{{ 'Auto' | t: 'staff.schemeVerification.row.auto' }}</span> } } @else { {{ 'Not yet allotted' | t: 'staff.schemeVerification.row.notAllotted' }} }</dd></div>
        <div><dt>{{ 'Allotted on' | t: 'staff.schemeVerification.onsite.allotted' }}</dt><dd>{{ day(o.allotmentDate) || '–' }}</dd></div>
        <div><dt>{{ 'Onsite assessor' | t: 'staff.schemeVerification.onsite.assessor' }}</dt>
          <dd>{{ o.assessor ? (o.assessor.name || o.assessor.userId) + ' (' + o.assessor.userId + ')' : ('Not yet named' | t: 'staff.schemeVerification.row.notNamed') }}</dd></div>
        <div><dt>{{ 'Date of verification' | t: 'staff.schemeVerification.onsite.visit' }}</dt><dd data-visit>{{ o.visitStartedOn ? day(o.visitStartedOn) + ' ' + time(o.visitStartedOn) : ('Visit not started' | t: 'staff.schemeVerification.onsite.notStarted') }}</dd></div>
        @if (o.visitSubmittedOn) { <div><dt>{{ 'Report submitted on' | t: 'staff.schemeVerification.onsite.submitted' }}</dt><dd>{{ day(o.visitSubmittedOn) }}</dd></div> }
        @if (o.representativeName || o.representativeMobile) {
          <div><dt>{{ 'Unit representative' | t: 'staff.schemeVerification.onsite.representative' }}</dt><dd>{{ o.representativeName }}@if (o.representativeMobile) { · {{ o.representativeMobile }} }</dd></div>
        }
        @if (o.latitude && o.longitude) {
          <div><dt>{{ 'Visit location' | t: 'staff.schemeVerification.onsite.location' }}</dt><dd>{{ o.latitude }}, {{ o.longitude }}</dd></div>
        }
        @if (o.rejectedAgencies) { <div><dt>{{ 'Rejected by' | t: 'staff.schemeVerification.onsite.rejectedBy' }}</dt><dd>{{ o.rejectedAgencies }}</dd></div> }
      </dl>
      @if (o.verifiedClaim !== null) {
        <div class="so-totals" role="list">
          <div role="listitem"><small>{{ 'Claim verified onsite' | t: 'staff.schemeVerification.onsite.verified' }}</small><b data-onsite="verified">Rs. {{ money(o.verifiedClaim) }}</b></div>
          <div role="listitem"><small>{{ 'Eligible on it' | t: 'staff.schemeVerification.onsite.eligible' }}</small><b data-onsite="eligible">Rs. {{ money(o.eligible) }}</b></div>
        </div>
      }
      @if (o.remarks) {
        <p class="so-remarks"><b>{{ 'Assessor’s remarks' | t: 'staff.schemeVerification.onsite.remarks' }}:</b> {{ o.remarks }}</p>
      }
      @if (o.photos.length) {
        <h5>{{ 'Photos' | t: 'staff.schemeVerification.onsite.photos' }} <small>{{ '{min} to {max} per item' | t: 'staff.schemeVerification.onsite.photosRule' : { min: o.photosMin, max: o.photosMax } }}</small></h5>
        <ul class="so-photos">
          @for (p of o.photos; track p.photoId) {
            <li>
              <a [href]="p.url" target="_blank" rel="noopener"><img [src]="p.url" [alt]="photoLabel(p)" loading="lazy" /></a>
              <span>{{ photoLabel(p) }}</span>
              @if (p.latitude && p.longitude) { <small>{{ p.latitude }}, {{ p.longitude }}</small> }
              @if (p.timeStamp || p.on) { <small>{{ p.timeStamp || day(p.on) }}</small> }
            </li>
          }
        </ul>
      } @else if (o.visitStartedOn) {
        <p class="sub">{{ 'No photo yet.' | t: 'staff.schemeVerification.onsite.noPhotos' }}</p>
      }
      @if (o.checks.length) {
        <h5>{{ 'Checked at the visit' | t: 'staff.schemeVerification.onsite.checks' }}</h5>
        <table class="table so-table">
          <tbody>
            @for (c of o.checks; track c.path) {
              <tr [class.so-no]="c.status === 'No'">
                <th scope="row">{{ c.label }}</th>
                <td>{{ c.value || '–' }}</td>
                <td>
                  @if (c.status) {
                    <span [class]="'chip ' + (c.status === 'Yes' ? 'is-good' : 'is-bad')">{{ c.status === 'Yes' ? ('Valid' | t: 'staff.schemeVerification.answers.valid') : ('Not valid' | t: 'staff.schemeVerification.answers.notValid') }}</span>
                    @if (c.remarks) { <small class="d-block">{{ c.remarks }}</small> }
                  } @else {
                    <span class="sub">{{ 'Not checked' | t: 'staff.schemeVerification.answers.unchecked' }}</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
  styles: `
    .so { padding: 16px 20px; margin-bottom: 16px; }
    .so h4 { font-size: 16px; margin-bottom: 10px; }
    .so h5 { font-size: 14px; color: #24666b; margin: 14px 0 8px; }
    .so h5 small { color: #5f6f70; font-weight: 400; margin-left: 6px; }
    .so-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 20px; margin: 0 0 12px; }
    .so-facts dt { font-size: 12px; color: #5f6f70; font-weight: 500; }
    .so-facts dd { margin: 0; font-size: 13.5px; color: #17373b; }
    .so-auto { background: #e7f3f4; color: #2f6f75; margin-left: 4px; }
    .so-totals { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
    .so-totals > div { flex: 1 1 160px; border: 1px solid #dde7e8; border-radius: 10px; padding: 10px 14px; background: #f7fbfb; }
    .so-totals small { display: block; font-size: 12px; color: #5f6f70; }
    .so-totals b { font-size: 17px; color: #17373b; }
    .so-remarks { font-size: 13px; white-space: pre-wrap; margin: 8px 0; }
    .so-photos { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
    .so-photos li { display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
    .so-photos img { width: 100%; height: 110px; object-fit: cover; border-radius: 8px; border: 1px solid #dde7e8; }
    .so-photos small { color: #5f6f70; }
    .so-table { margin: 0; font-size: 13px; }
    .so-table th { width: 34%; font-weight: 500; color: #5f6f70; }
    tr.so-no > th { box-shadow: inset 3px 0 0 #d64532; }
  `,
})
export class SchemeOnsiteReportView {
  readonly report = input.required<SchemeOnsiteReport>();
  readonly status = input<string>('');
  protected readonly money = money;
  protected readonly day = day;

  protected time(v: string | null): string {
    if (!v) return '';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  protected photoLabel(p: SchemeOnsitePhoto): string {
    switch (p.kind) {
      case 'selfie': return t('staff.schemeVerification.onsite.selfie', 'Selfie at the unit');
      case 'site': return t('staff.schemeVerification.onsite.site', 'Site photo');
      default: return p.title ?? t('staff.schemeVerification.onsite.item', 'Item');
    }
  }
}
