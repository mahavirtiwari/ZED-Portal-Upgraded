import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { TextPipe, t } from '../../content/page-text';
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
const TRACKER: { readonly label: string; readonly note: string; readonly subtitle: Partial<Record<Step, (v: { step: number; steps: number }) => string>> }[] = [
  { get label() { return t('msme.financialAssistance.tracker.disclaimerLabel', 'Disclaimer'); },
    get note() { return t('msme.financialAssistance.tracker.disclaimerNote', 'Disclaimer, instructions'); },
    subtitle: {
      1: (v) => t('msme.financialAssistance.step1.sub', 'Step {step} of {steps}: read and accept the disclaimer before you start a claim.', v),
      2: (v) => t('msme.financialAssistance.step2.sub', 'Step {step} of {steps}: read the instructions before you start a claim.', v) } },
  { get label() { return t('msme.financialAssistance.tracker.unitLabel', 'Confirm unit'); },
    get note() { return t('msme.financialAssistance.tracker.unitNote', 'Unit and activity'); },
    subtitle: { 3: (v) => t('msme.financialAssistance.step3.sub', 'Step {step} of {steps}: confirm the unit the claim is for.', v) } },
  { get label() { return t('msme.financialAssistance.tracker.claimLabel', 'Claim details'); },
    get note() { return t('msme.financialAssistance.tracker.claimNote', 'Certification, cost, bank, documents'); },
    subtitle: {
      4: (v) => t('msme.financialAssistance.step4.sub', 'Step {step} of {steps}: enter the certification, expenditure and bank details and upload the documents.', v) } },
  { get label() { return t('msme.financialAssistance.tracker.reviewLabel', 'Review & submit'); },
    get note() { return t('msme.financialAssistance.tracker.reviewNote', 'Eligible amount'); },
    subtitle: { summary: (v) => t('msme.financialAssistance.summaryStep.sub', 'Step {step} of {steps}: check the eligible amount and submit the claim.', v) } },
];

/** What the rail says comes next, per step. */
const NEXT: Partial<Record<Step, () => string>> = {
  1: () => t('msme.financialAssistance.next.step1Text', 'After you accept, you read the instructions, confirm your unit, enter the certification, expenditure and bank details with the documents, and submit the claim for scrutiny.'),
  2: () => t('msme.financialAssistance.next.step2Text', 'After you accept, you confirm your unit and then enter the claim details.'),
  3: () => t('msme.financialAssistance.next.step3Text', 'Next you enter the certification, expenditure and bank details and upload the documents.'),
  4: () => t('msme.financialAssistance.next.step4Text', 'Next you check the eligible amount and submit the claim for scrutiny.'),
  summary: () => t('msme.financialAssistance.next.summaryText', 'After you submit, the claim goes for scrutiny and a confirmation is e-mailed to you.'),
};

/** FinancialAssistance.VerificationStatus as the MSME sees it. */
const STATUS: Record<number, () => string> = {
  1: () => t('msme.financialAssistance.status.submitted', 'Submitted'),
  2: () => t('msme.financialAssistance.status.verifying', 'Under verification'),
  3: () => t('msme.financialAssistance.status.verifying', 'Under verification'),
  4: () => t('msme.financialAssistance.status.approved', 'Approved'),
  6: () => t('msme.financialAssistance.status.reimbursed', 'Reimbursed'),
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
  imports: [FormsModule, RouterLink, SchemeUnitPanel, SchemeDocumentField, AlertDialog, ContentTextComponent, PageHead, StepTracker, TextPipe],
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

  protected get crumbs(): Crumb[] {
    return [{ label: t('msme.financialAssistance.crumb.home', 'Home'), link: '/msme/dashboard' },
      { label: t('msme.financialAssistance.crumb.incentives', 'Incentives'), link: '/msme/dashboard', fragment: 'incentives' },
      { label: t('msme.financialAssistance.crumb.page', 'Financial assistance') }];
  }
  protected readonly sharePct = FA_SHARE * 100;
  protected readonly cap = FA_CAP.toLocaleString('en-IN');
  /** The documents the claim form asks for (the CA certificate is optional), then the bank details. */
  protected readonly keepReady = computed(() => [
    t('msme.financialAssistance.ready.point1', 'Copy of the testing, system or product certificate'),
    t('msme.financialAssistance.ready.point2', 'Invoice / bill of the certifying agency'),
    t('msme.financialAssistance.ready.point3', 'CA certificate of expenditure (optional)'),
    t('msme.financialAssistance.ready.point4', "Cancelled cheque of the unit's account"),
    t('msme.financialAssistance.ready.point5', 'Bank account number, IFSC and branch'),
  ]);

  /** 0-based tracker step of the page's step (past the last once submitted). */
  protected readonly trackerIndex = computed(() => {
    const s = this.step();
    return s === 1 || s === 2 ? 0 : s === 3 ? 1 : s === 4 ? 2 : s === 'summary' ? 3 : 4;
  });
  protected readonly trackerSteps = computed<TrackerStep[]>(() =>
    TRACKER.map((s, i) => ({ label: s.label, note: i === this.trackerIndex() ? t('msme.financialAssistance.tracker.hereNote', 'You are here') : s.note })));
  protected readonly subtitle = computed(() => {
    const i = this.trackerIndex();
    const line = TRACKER[i]?.subtitle[this.step()];
    return line ? line({ step: i + 1, steps: TRACKER.length }) : null;
  });
  protected readonly next = computed(() => NEXT[this.step()]?.() ?? null);
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
      { label: t('msme.financialAssistance.unit.enterpriseLabel', 'Enterprise'), lines: values('EnterpriseName'), wide: false },
      { label: t('msme.financialAssistance.unit.typeLabel', 'Enterprise type'), lines: values(u['RegistrationType'] === 'UAM' ? 'EnterpriseTypee' : 'EnterpriseType'), wide: false },
      { label: t('msme.financialAssistance.unit.udyamLabel', 'UDYAM number'), lines: values('UdyogAadharNo'), wide: false },
      { label: t('msme.financialAssistance.unit.zedIdLabel', 'ZED ID'), lines: values('ZedId'), wide: false },
      { label: t('msme.financialAssistance.unit.emailLabel', 'Provided e-mail ID'), lines: values('PledgeEmailId'), wide: false },
      { label: t('msme.financialAssistance.unit.unitLabel', 'Selected unit'), lines: values('PUnitName'), wide: false },
      { label: t('msme.financialAssistance.unit.addressLabel', 'Address'), lines: [values('PAddress', 'PDistrictName', 'PStateName', 'PPin').join(', ')].filter(Boolean), wide: true },
      { label: t('msme.financialAssistance.unit.activityLabel', 'Selected activity'), lines: values('Activity', 'TwoDigitActivity', 'FourDigitActivity', 'FiveDigitActivity'), wide: true },
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
    return STATUS[Number(app.details['VerificationStatus'])]?.() ?? '';
  }

  /** The certificate category as shown (the value stays Quality / Product / Testing). */
  protected categoryLabel(c: string): string {
    return c === 'Quality' ? t('msme.financialAssistance.category.quality', 'System/Quality')
      : c === 'Product' ? t('msme.financialAssistance.category.product', 'Product') : t('msme.financialAssistance.category.testing', 'Testing');
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
      this.alert.set(errorAlert(t('msme.financialAssistance.error.required', 'Please enter required data.')));
      return;
    }
    if (a.accountNo.trim() !== a.confirmAccountNo.trim()) {
      this.alert.set(errorAlert(t('msme.financialAssistance.error.accountMismatch', 'Account Number and Re-Enter Account Number must match.')));
      return;
    }
    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(a.ifscCode.trim())) {
      this.alert.set(errorAlert(t('msme.financialAssistance.error.ifsc', 'Invalid IFSC Code format. Please enter the correct 11-digit code.')));
      return;
    }
    // The CA certificate is optional, but the expenditure section needs two documents at least (as the live form).
    const requiredDocs = [FA_DOCUMENTS.certificate, FA_DOCUMENTS.invoice, FA_DOCUMENTS.cheque];
    if (requiredDocs.some((d) => this.docs(d).length === 0) || this.docs(FA_DOCUMENTS.ca).length + this.docs(FA_DOCUMENTS.invoice).length < 2) {
      this.alert.set(errorAlert(t('msme.financialAssistance.error.documents', 'Please upload the required documents.')));
      return;
    }
    if (!f.declaration) {
      this.alert.set(errorAlert(t('msme.financialAssistance.error.declaration', 'Please accept the declaration.')));
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
