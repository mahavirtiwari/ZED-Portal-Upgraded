import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { AdminPortal } from '../admin-portal';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { ExpenditureApi, TaxDetails, TaxFile, gstinProblem, openBlob, panProblem, shownDate } from './expenditure.api';
import { TextPipe, t } from '../../content/page-text';

export const MAX_TAX_FILE_BYTES = 5 * 1024 * 1024;
const TYPES = /\.(pdf|jpe?g|png)$/i;

/**
 * 2026-11-18 (the user: "Before uploading any invoices, assessment agency has to provide their GSTIN number, PAN number, and
 * also upload the same. This should be for one time only and cannot be updated."): the agency's (consultant
 * organisation's) GSTIN and PAN with the GST registration certificate and the PAN card.
 * <ul>
 * <li><code>editable</code> (the agency's own Expenditure page) and not submitted: the one-time form (GSTIN pre-filled from
 * the agency form, PAN = characters 3-12 of the GSTIN, both documents as PDF / JPG / PNG up to 5 MB, the declaration), then a
 * confirmation; the server refuses a second submission.</li>
 * <li>Submitted: read-only, locked, with the two documents (also for the master admin: Expenditure tab, invoice review,
 * purchase orders). There is no edit.</li>
 * </ul>
 */
@Component({
  selector: 'zed-tax-details',
  imports: [FormsModule, ConfirmDialog, TextPipe],
  host: { '[class.compact]': 'compact()' },
  styles: `
    :host { display: block; }
    .tx { padding: 14px 16px; margin-bottom: 16px; }
    :host(.compact) .tx { padding: 10px 12px; margin: 0 0 12px; border: 1px solid #dde7e8; border-radius: 10px; box-shadow: none; }
    .tx h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #17373b; }
    :host(.compact) h2 { font-size: 13.5px; }
    .tx p { margin: 0 0 10px; font-size: 12.5px; color: #6f8487; }
    .tx-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px 16px; margin-bottom: 10px; font-size: 13px; }
    .tx-grid small { display: block; color: #6f8487; font-size: 11.5px; }
    .tx-grid b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.04em; }
    .tx-form label > span { display: block; margin-bottom: 4px; font-size: 12.5px; font-weight: 600; color: #3d5559; }
    .tx-form .hint { display: block; margin-top: 3px; font-size: 11.5px; color: #6f8487; }
    .tx-form .up { text-transform: uppercase; }
    .tx-tick { display: flex; gap: 8px; align-items: flex-start; margin: 12px 0; font-size: 13px; color: #3d5559; }
    .tx-tick input { margin-top: 3px; }
    .tx-acts { display: flex; flex-wrap: wrap; gap: 8px; }
  `,
  template: `
    @if (tax(); as tx) {
      @if (tx.submitted) {
        <section class="zed-card tx" aria-labelledby="tx-title">
          <h2 id="tx-title">{{ 'GSTIN and PAN' | t: 'staff.expenditure.tax.title' }} <span class="status-badge is-active">{{ 'Locked' | t: 'staff.expenditure.tax.lockedLabel' }}</span></h2>
          <div class="tx-grid">
            <div><small>{{ 'GSTIN' | t: 'staff.expenditure.tax.gstinLabel' }}</small><b>{{ tx.gstin }}</b></div>
            <div><small>{{ 'PAN' | t: 'staff.expenditure.tax.panLabel' }}</small><b>{{ tx.pan }}</b></div>
            <div><small>{{ 'Submitted on' | t: 'staff.expenditure.tax.submittedOnLabel' }}</small>{{ date(tx.submittedOn) }}@if (tx.submittedBy) { · {{ tx.submittedBy }} }</div>
          </div>
          <div class="tx-acts">
            <button type="button" class="btn btn-default btn-sm" [disabled]="!tx.hasGstFile" (click)="view('gst')">{{ 'View GST Certificate' | t: 'staff.expenditure.tax.viewGstButton' }}</button>
            <button type="button" class="btn btn-default btn-sm" [disabled]="!tx.hasPanFile" (click)="view('pan')">{{ 'View PAN Card' | t: 'staff.expenditure.tax.viewPanButton' }}</button>
          </div>
          @if (editable()) { <p class="mt-2 mb-0">{{ 'Submitted once; they cannot be changed. Write to the master admin if they are wrong.' | t: 'staff.expenditure.tax.lockedNote' }}</p> }
        </section>
      } @else if (editable()) {
        <section class="zed-card tx" aria-labelledby="tx-title">
          <h2 id="tx-title">{{ 'GSTIN and PAN' | t: 'staff.expenditure.tax.title' }} <span class="status-badge is-pending">{{ 'Needed before your first invoice' | t: 'staff.expenditure.tax.neededLabel' }}</span></h2>
          @if (!tx.available) {
            <p>{{ 'The tax details cannot be given yet. Please try again later.' | t: 'staff.expenditure.tax.unavailableText' }}</p>
          } @else {
            <p>{{ 'Given once: after you submit, they cannot be changed. The master admin sees them with every invoice.' | t: 'staff.expenditure.tax.formNote' }}</p>
            <form class="tx-form" (ngSubmit)="check()">
              @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
              <div class="row g-3">
                <label class="col-md-6"><span>{{ 'GSTIN' | t: 'staff.expenditure.tax.gstinLabel' }}</span>
                  <input class="form-control up" name="gstin" maxlength="15" autocomplete="off" [ngModel]="gstin()" (ngModelChange)="gstin.set($event)" />
                  @if (tx.suggestedGstin) { <span class="hint">{{ "From your agency's record; check it before submitting." | t: 'staff.expenditure.tax.gstinHint' }}</span> }</label>
                <label class="col-md-6"><span>{{ 'PAN' | t: 'staff.expenditure.tax.panLabel' }}</span>
                  <input class="form-control up" name="pan" maxlength="10" autocomplete="off" [ngModel]="pan()" (ngModelChange)="pan.set($event)" />
                  @if (panOfGstin()) { <span class="hint">{{ 'Characters 3 to 12 of the GSTIN: {pan}' | t: 'staff.expenditure.tax.panHint' : { pan: panOfGstin() } }}</span> }</label>
                <label class="col-md-6"><span>{{ 'GST registration certificate' | t: 'staff.expenditure.tax.gstFileLabel' }}</span>
                  <input type="file" class="form-control" name="gstFile" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" (change)="pick('gst', $event)" />
                  <span class="hint">{{ 'PDF, JPG or PNG, up to 5 MB' | t: 'staff.expenditure.tax.fileHint' }}</span></label>
                <label class="col-md-6"><span>{{ 'PAN card' | t: 'staff.expenditure.tax.panFileLabel' }}</span>
                  <input type="file" class="form-control" name="panFile" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" (change)="pick('pan', $event)" />
                  <span class="hint">{{ 'PDF, JPG or PNG, up to 5 MB' | t: 'staff.expenditure.tax.fileHint' }}</span></label>
              </div>
              <label class="tx-tick"><input type="checkbox" name="declaration" [ngModel]="declared()" (ngModelChange)="declared.set($event)" />
                <span>{{ 'I declare that this GSTIN and PAN are ours and correct, and that the documents are true copies. I understand they cannot be changed after submitting.' | t: 'staff.expenditure.tax.declarationLabel' }}</span></label>
              <button type="submit" class="btn btn-primary">{{ 'Submit Tax Details' | t: 'staff.expenditure.tax.submitButton' }}</button>
            </form>
          }
        </section>
      } @else if (tx.available) {
        <section class="zed-card tx"><h2>{{ 'GSTIN and PAN' | t: 'staff.expenditure.tax.title' }} <span class="status-badge is-inactive">{{ 'Not submitted yet' | t: 'staff.expenditure.tax.notSubmittedLabel' }}</span></h2></section>
      }
    }
    @if (confirming()) {
      <zed-confirm-dialog [ask]="ask()" [busy]="busy()" [failed]="failed()" inputId="tax-confirm" (confirmed)="send()" (cancel)="confirming.set(false)" />
    }
  `,
})
export class TaxDetailsCard {
  private readonly api = inject(ExpenditureApi);
  private readonly toast = inject(ToastService);

  readonly tax = input<TaxDetails | null | undefined>(null);
  /** The agency (organisation) whose documents open. */
  readonly partyId = input('');
  readonly portal = input<AdminPortal | null>(null);
  /** The agency's own page: the one-time form while nothing was submitted. */
  readonly editable = input(false);
  /** Inside a pop-up or card: smaller, bordered. */
  readonly compact = input(false);
  /** The details were submitted (the page reloads). */
  readonly saved = output<void>();

  protected readonly gstin = signal('');
  protected readonly pan = signal('');
  protected readonly declared = signal(false);
  protected readonly error = signal('');
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly failed = signal('');
  protected readonly date = shownDate;
  private files: Record<TaxFile, File | null> = { gst: null, pan: null };

  protected readonly panOfGstin = computed(() => {
    const g = this.gstin().trim().toUpperCase();
    return g.length >= 12 ? g.slice(2, 12) : '';
  });

  protected readonly ask = computed<ConfirmAsk>(() => ({
    title: t('staff.expenditure.tax.confirm.title', 'Submit GSTIN and PAN?'),
    subtitle: t('staff.expenditure.tax.confirm.sub', '{gstin} · {pan}', { gstin: this.gstin().trim().toUpperCase(), pan: this.pan().trim().toUpperCase() }),
    icon: 'lock',
    tone: 'warn',
    points: [
      t('staff.expenditure.tax.confirm.point1', 'They are saved once and cannot be changed afterwards.'),
      t('staff.expenditure.tax.confirm.point2', 'The master admin sees them, with both documents, on every invoice.'),
      t('staff.expenditure.tax.confirm.point3', 'After this you can upload your monthly invoices.'),
    ],
    confirmLabel: t('staff.expenditure.tax.confirm.submitButton', 'Submit'),
  }));

  constructor() {
    // Pre-fill the GSTIN of the agency form (and its PAN) once, while nothing was typed.
    effect(() => {
      const s = this.tax()?.suggestedGstin;
      if (s && !this.gstin()) {
        this.gstin.set(s);
        if (!this.pan()) this.pan.set(s.slice(2, 12));
      }
    });
  }

  protected pick(which: TaxFile, ev: Event): void {
    this.files[which] = (ev.target as HTMLInputElement).files?.[0] ?? null;
  }

  /** Checks the form as the server does, then asks for confirmation. */
  protected check(): void {
    const problem = this.problem();
    this.error.set(problem ?? '');
    if (problem) return;
    this.failed.set('');
    this.confirming.set(true);
  }

  private problem(): string | null {
    const g = gstinProblem(this.gstin());
    if (g) return g;
    const p = panProblem(this.pan(), this.gstin());
    if (p) return p;
    const gst = this.files.gst;
    if (!gst) return t('staff.expenditure.tax.gstFileMissingError', 'Please upload the GST registration certificate (PDF, JPG or PNG, up to 5 MB).');
    if (!TYPES.test(gst.name)) return t('staff.expenditure.tax.gstFileTypeError', 'The GST registration certificate must be a PDF, JPG or PNG file.');
    if (gst.size > MAX_TAX_FILE_BYTES) return t('staff.expenditure.tax.gstFileSizeError', 'The GST registration certificate is larger than 5 MB.');
    const panFile = this.files.pan;
    if (!panFile) return t('staff.expenditure.tax.panFileMissingError', 'Please upload the PAN card (PDF, JPG or PNG, up to 5 MB).');
    if (!TYPES.test(panFile.name)) return t('staff.expenditure.tax.panFileTypeError', 'The PAN card must be a PDF, JPG or PNG file.');
    if (panFile.size > MAX_TAX_FILE_BYTES) return t('staff.expenditure.tax.panFileSizeError', 'The PAN card is larger than 5 MB.');
    return this.declared() ? null : t('staff.expenditure.tax.declarationError', 'Please tick the declaration: the details are correct and cannot be changed later.');
  }

  protected async send(): Promise<void> {
    const form = new FormData();
    form.append('gstin', this.gstin().trim().toUpperCase());
    form.append('pan', this.pan().trim().toUpperCase());
    form.append('declaration', String(this.declared()));
    form.append('gstFile', this.files.gst!, this.files.gst!.name);
    form.append('panFile', this.files.pan!, this.files.pan!.name);
    this.busy.set(true);
    this.failed.set('');
    try {
      const r = await firstValueFrom(this.api.submitTax(form));
      this.toast.success(r.message);
      this.confirming.set(false);
      this.saved.emit();
    } catch (e) {
      this.failed.set(apiErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async view(which: TaxFile): Promise<void> {
    try {
      openBlob(await firstValueFrom(this.api.taxFile(which, this.partyId(), this.portal())));
    } catch (e) {
      this.toast.error(t('staff.expenditure.tax.toast.openFailed', 'The document could not be opened'), apiErrorMessage(e));
    }
  }
}
