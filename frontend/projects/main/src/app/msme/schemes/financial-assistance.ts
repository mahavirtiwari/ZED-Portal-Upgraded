import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { AlertDialog, AlertMessage, errorAlert } from '../shared/alert-dialog';
import { fieldError } from '../shared/field-error';
import { SchemeDocumentField, SchemeIntro, SchemeUnitPanel } from './scheme-parts';
import { FaApplication, FaPage, FaSubmission, SchemeDocument, SchemesApi, inr, todayIso, uploadProblem } from './schemes.api';

export const FA_DOCUMENTS = {
  certificate: 'Copy of Certificate',
  ca: 'CA certificate of expenditure',
  invoice: 'Copy of Invoice',
  cheque: 'Copy of Cancelled Cheque',
} as const;

type Step = 1 | 2 | 3 | 4 | 'summary' | 'done';

/** FinancialAssistance.VerificationStatus as the MSME sees it. */
const STATUS: Record<number, string> = {
  1: 'Submitted', 2: 'Under verification', 3: 'Under verification', 4: 'Approved', 6: 'Reimbursed',
};

/**
 * Financial assistance (75% of the cost of one testing / system / product certification, max Rs. 50,000).
 * Port of Frontend/FinancialAssistance/Index.cshtml (disclaimer, instructions, unit confirmation, form,
 * summary, success) and Details.cshtml (the MSME's own applications, shown when it cannot apply again).
 */
@Component({
  selector: 'zed-msme-financial-assistance',
  imports: [FormsModule, RouterLink, SchemeUnitPanel, SchemeIntro, SchemeDocumentField, AlertDialog, ContentTextComponent],
  templateUrl: './financial-assistance.html',
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .btn-disabled { opacity: .5; }
  `,
})
export class FinancialAssistancePage {
  private readonly api = inject(SchemesApi);

  protected readonly docTypes = FA_DOCUMENTS;
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  /** Error pop-up (the legacy swal). */
  protected readonly alert = signal<AlertMessage | null>(null);
  protected readonly page = signal<FaPage | null>(null);
  protected readonly step = signal<Step>(1);
  protected readonly confirmed = signal(false);
  protected readonly documents = signal<SchemeDocument[]>([]);
  protected readonly today = todayIso();
  protected readonly inr = inr;
  protected readonly fieldError = fieldError;

  protected readonly unit = computed(() => this.page()?.unit ?? {});
  protected readonly applications = computed(() => this.page()?.applications ?? []);

  protected form: Omit<FaSubmission, 'documents'> = {
    categoryOfCertificate: '',
    nameOfCertficate: '',
    certificationAgency: '',
    certficateNumber: '',
    dateOfIssue: '',
    validityOfCertificate: null,
    anyOtherInformation: '',
    invoiceNo: '',
    invoiceBillDate: '',
    amountPaid: null,
    modeOfPayment: '',
    account: { accountNo: '', confirmAccountNo: '', ifscCode: '', branchAddress: '', bankName: '' },
    declaration: false,
  };

  constructor() {
    void this.load();
  }

  /** 75% of the amount paid (whole rupees), max Rs. 50,000 — shown on the summary; the server computes the stored value. */
  protected eligible(): number {
    const amount = Math.trunc(Number(this.form.amountPaid) || 0);
    return Math.min(amount * 0.75, 50000);
  }

  protected docs(type: string): SchemeDocument[] {
    return this.documents().filter((d) => d.type === type);
  }

  protected status(app: FaApplication): string {
    return STATUS[Number(app.details['VerificationStatus'])] ?? '';
  }

  protected appDocs(app: FaApplication, type: string): SchemeDocument[] {
    return app.documents.filter((d) => d.type === type);
  }

  protected go(step: Step): void {
    this.step.set(step);
    window.scrollTo?.(0, 0);
  }

  protected async upload(type: string, file: File): Promise<void> {
    const problem = uploadProblem(file);
    if (problem) {
      this.alert.set(errorAlert(problem));
      return;
    }
    this.busy.set(true);
    try {
      const doc = await firstValueFrom(this.api.upload('fa', type, file));
      this.documents.update((list) => [...list, doc]);
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
    } finally {
      this.busy.set(false);
    }
  }

  protected removeDoc(fileName: string): void {
    this.documents.update((list) => list.filter((d) => d.fileName !== fileName));
  }

  /** Browser checks of the legacy page before the summary; the server checks everything again. */
  protected review(): void {
    const f = this.form;
    const a = f.account;
    const required = [f.categoryOfCertificate, f.nameOfCertficate, f.certificationAgency, f.certficateNumber, f.dateOfIssue,
      f.invoiceNo, f.invoiceBillDate, f.modeOfPayment, a.accountNo, a.confirmAccountNo, a.ifscCode, a.branchAddress, a.bankName];
    if (required.some((v) => !String(v ?? '').trim()) || !f.validityOfCertificate || !f.amountPaid) {
      this.alert.set(errorAlert('Please enter required data.'));
      return;
    }
    if (a.accountNo.trim() !== a.confirmAccountNo.trim()) {
      this.alert.set(errorAlert('Account Number and Re-Enter Account Number must match.'));
      return;
    }
    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(a.ifscCode.trim())) {
      this.alert.set(errorAlert('Invalid IFSC Code format. Please enter the correct 11-digit code.'));
      return;
    }
    // The CA certificate is optional, but the expenditure section needs two documents at least (as the live form).
    const requiredDocs = [FA_DOCUMENTS.certificate, FA_DOCUMENTS.invoice, FA_DOCUMENTS.cheque];
    if (requiredDocs.some((t) => this.docs(t).length === 0) || this.docs(FA_DOCUMENTS.ca).length + this.docs(FA_DOCUMENTS.invoice).length < 2) {
      this.alert.set(errorAlert('Please upload the required documents.'));
      return;
    }
    if (!f.declaration) {
      this.alert.set(errorAlert('Please accept the declaration.'));
      return;
    }
    this.go('summary');
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    try {
      const body: FaSubmission = {
        ...this.form,
        documents: this.documents().map((d) => ({ fileName: d.fileName, type: d.type ?? '' })),
      };
      await firstValueFrom(this.api.submitFa(body));
      this.go('done');
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
    } finally {
      this.busy.set(false);
    }
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.page.set(await firstValueFrom(this.api.faPage()));
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
    } finally {
      this.loading.set(false);
    }
  }
}
