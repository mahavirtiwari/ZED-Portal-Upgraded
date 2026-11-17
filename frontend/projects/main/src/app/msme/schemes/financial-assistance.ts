import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { AlertDialog, AlertMessage, errorAlert } from '../shared/alert-dialog';
import { fieldError } from '../shared/field-error';
import { SchemeDocumentField, SchemeUnitPanel } from './scheme-parts';
import { FaApplication, FaPage, FaSubmission, SchemeDocument, SchemesApi, inr, todayIso, uploadProblem } from './schemes.api';
import { Crumb, PageHead } from '../shared/page-head';
import { StepTracker, TrackerStep } from '../shared/step-tracker';

export const FA_DOCUMENTS = {
  certificate: 'Copy of Certificate',
  ca: 'CA certificate of expenditure',
  invoice: 'Copy of Invoice',
  cheque: 'Copy of Cancelled Cheque',
} as const;

type Step = 1 | 2 | 3 | 4 | 'summary' | 'done';

/** The subsidy: 75% of the amount paid (whole rupees), at most Rs. 50,000 (as the server, MsmeFinancialAssistanceController). */
export const FA_SHARE = 0.75;
export const FA_CAP = 50000;

/**
 * 2026-11-17 (the user's design zed-msme-05): the four steps of the tracker, mapped onto the page's own steps:
 * disclaimer and instructions (1, 2), unit confirmation (3), the claim form with its documents (4), the summary.
 * The form takes the details and the documents together, so there is no separate "upload documents" step.
 */
const TRACKER: { label: string; note: string; subtitle: Partial<Record<Step, string>> }[] = [
  { label: 'Disclaimer', note: 'Disclaimer, instructions', subtitle: {
    1: 'read and accept the disclaimer before you start a claim.', 2: 'read the instructions before you start a claim.' } },
  { label: 'Confirm unit', note: 'Unit and activity', subtitle: { 3: 'confirm the unit the claim is for.' } },
  { label: 'Claim details', note: 'Certification, cost, bank, documents', subtitle: {
    4: 'enter the certification, expenditure and bank details and upload the documents.' } },
  { label: 'Review & submit', note: 'Eligible amount', subtitle: { summary: 'check the eligible amount and submit the claim.' } },
];

/** What the rail says comes next, per step. */
const NEXT: Partial<Record<Step, string>> = {
  1: 'After you accept, you read the instructions, confirm your unit, enter the certification, expenditure and bank details with the documents, and submit the claim for scrutiny.',
  2: 'After you accept, you confirm your unit and then enter the claim details.',
  3: 'Next you enter the certification, expenditure and bank details and upload the documents.',
  4: 'Next you check the eligible amount and submit the claim for scrutiny.',
  summary: 'After you submit, the claim goes for scrutiny and a confirmation is e-mailed to you.',
};

/** FinancialAssistance.VerificationStatus as the MSME sees it. */
const STATUS: Record<number, string> = {
  1: 'Submitted', 2: 'Under verification', 3: 'Under verification', 4: 'Approved', 6: 'Reimbursed',
};

/**
 * Financial assistance (75% of the cost of one testing / system / product certification, max Rs. 50,000).
 * Port of Frontend/FinancialAssistance/Index.cshtml (disclaimer, instructions, unit confirmation, form,
 * summary, success) and Details.cshtml (the MSME's own applications, shown when it cannot apply again).
 * 2026-11-17 (the user's design zed-msme-05): page head, four-step tracker, headline facts, the disclaimer with an
 * explicit consent before "Accept & proceed", and the rail (eligibility, documents to keep ready, what happens next).
 */
@Component({
  selector: 'zed-msme-financial-assistance',
  imports: [FormsModule, RouterLink, SchemeUnitPanel, SchemeDocumentField, AlertDialog, ContentTextComponent, PageHead, StepTracker],
  templateUrl: './financial-assistance.html',
  styleUrls: ['../shared/msme-page.scss', './scheme-page.scss', './financial-assistance.scss', './financial-assistance-form.scss'],
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
  /** The explicit consent to the disclaimer before "Accept & proceed". */
  protected readonly consent = signal(false);
  protected readonly documents = signal<SchemeDocument[]>([]);
  protected readonly today = todayIso();
  protected readonly inr = inr;
  protected readonly fieldError = fieldError;

  protected readonly unit = computed(() => this.page()?.unit ?? {});
  protected readonly applications = computed(() => this.page()?.applications ?? []);

  protected readonly crumbs: Crumb[] = [{ label: 'Home', link: '/msme/dashboard' }, { label: 'Incentives', link: '/msme/dashboard', fragment: 'incentives' }, { label: 'Financial assistance' }];
  protected readonly sharePct = FA_SHARE * 100;
  protected readonly cap = FA_CAP.toLocaleString('en-IN');
  /** The documents the claim form asks for (the CA certificate is optional), then the bank details. */
  protected readonly keepReady = [
    'Copy of the testing, system or product certificate', 'Invoice / bill of the certifying agency',
    'CA certificate of expenditure (optional)', "Cancelled cheque of the unit's account", 'Bank account number, IFSC and branch',
  ];

  /** 0-based tracker step of the page's step (past the last once submitted). */
  protected readonly trackerIndex = computed(() => {
    const s = this.step();
    return s === 1 || s === 2 ? 0 : s === 3 ? 1 : s === 4 ? 2 : s === 'summary' ? 3 : 4;
  });
  protected readonly trackerSteps = computed<TrackerStep[]>(() =>
    TRACKER.map((t, i) => ({ label: t.label, note: i === this.trackerIndex() ? 'You are here' : t.note })));
  protected readonly subtitle = computed(() => {
    const i = this.trackerIndex();
    const line = TRACKER[i]?.subtitle[this.step()];
    return line ? `Step ${i + 1} of ${TRACKER.length}: ${line}` : null;
  });
  protected readonly next = computed(() => NEXT[this.step()] ?? null);
  /** Where the page's Back goes (null = the dashboard). */
  protected readonly previous = computed<Step | null>(() => {
    const s = this.step();
    return s === 2 ? 1 : s === 3 ? 2 : s === 4 ? 3 : s === 'summary' ? 4 : null;
  });
  /** Step 3: the unit the claim is for, one line per value (rows the API leaves empty are not shown). */
  protected readonly unitRows = computed(() => {
    const u = this.unit();
    const values = (...keys: string[]) => keys.map((k) => u[k]).filter((v) => v !== null && v !== undefined && v !== '').map(String);
    return [
      { label: 'Enterprise', lines: values('EnterpriseName'), wide: false },
      { label: 'Enterprise type', lines: values(u['RegistrationType'] === 'UAM' ? 'EnterpriseTypee' : 'EnterpriseType'), wide: false },
      { label: 'UDYAM number', lines: values('UdyogAadharNo'), wide: false },
      { label: 'ZED ID', lines: values('ZedId'), wide: false },
      { label: 'Provided e-mail ID', lines: values('PledgeEmailId'), wide: false },
      { label: 'Selected unit', lines: values('PUnitName'), wide: false },
      { label: 'Address', lines: [values('PAddress', 'PDistrictName', 'PStateName', 'PPin').join(', ')].filter(Boolean), wide: true },
      { label: 'Selected activity', lines: values('Activity', 'TwoDigitActivity', 'FourDigitActivity', 'FiveDigitActivity'), wide: true },
    ].filter((r) => r.lines.length);
  });
  protected readonly unitLine = computed(() =>
    [this.unit()['PUnitName'], this.unit()['PDistrictName']].filter((v) => v !== null && v !== undefined && v !== '').join(', '));

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
    return Math.min(amount * FA_SHARE, FA_CAP);
  }

  /** Step 1: "Accept & proceed" once the consent box is ticked. */
  protected accept(): void {
    if (this.consent()) this.go(2);
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
