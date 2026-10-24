import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { FaAccount, FaApi, FaApplication, FaDocument, FaStatus } from './fa.api';

export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

interface Section {
  title: string;
  /** `prefix`: shown before the value, as the old page's "Rs." amounts. */
  fields: { label: string; key: string; prefix?: string }[];
  documents: { label: string; type: string }[];
  account?: boolean;
}

/** The three sections of the old page, with the document types the MSME app uploads for each. */
const SECTIONS: Section[] = [
  {
    title: 'Certification Details',
    fields: [
      { label: 'Category of Certificate', key: 'CategoryOfCertificate' },
      { label: 'Name of Certificate', key: 'NameOfCertficate' },
      { label: 'Name of Certification Agency', key: 'CertificationAgency' },
      { label: 'Certificate Number', key: 'CertficateNumber' },
      { label: 'Date of Issue of Certificate', key: 'DateOfIssue' },
      { label: 'Period of validity of Certificate', key: 'ValidityOfCertificate' },
      { label: 'Any other information related to this certificate', key: 'AnyOtherInformation' },
    ],
    documents: [{ label: 'Copy of Certificate', type: 'Copy of Certificate' }],
  },
  {
    title: 'Details of Expenditure',
    fields: [
      { label: 'Name of Certificate', key: 'ExpenditureCertficate' },
      { label: 'Name of Agency/Supplier', key: 'AgencyOrSupplier' },
      { label: 'Invoice/Bill No.', key: 'InvoiceNo' },
      { label: 'Invoice Bill Date', key: 'InvoiceBillDate' },
      { label: 'Amount Paid(Rs.)', key: 'AmountPaid', prefix: 'Rs.' },
      { label: 'Eligible Financial Assistance(Rs.)', key: 'EligibleAmount', prefix: 'Rs.' },
      { label: 'Mode of Payment', key: 'ModeOfPayment' },
    ],
    // Order and labels of the old page: the CA certificate row came before the invoice.
    documents: [
      { label: 'CA certificate of expenditure (Optional)', type: 'CA certificate of expenditure' },
      { label: 'Invoice Copy', type: 'Copy of Invoice' },
    ],
  },
  {
    title: 'Account Details of Reimbursement',
    fields: [
      { label: 'Account No.', key: 'AccountNo' },
      { label: 'IFSC Code', key: 'IfscCode' },
      { label: 'Branch Address', key: 'BranchAddress' },
      { label: 'Name of the Bank', key: 'BankName' },
    ],
    documents: [{ label: 'Cancelled Cheque Copy', type: 'Copy of Cancelled Cheque' }],
    account: true,
  },
];

const KNOWN_TYPES = new Set(SECTIONS.flatMap((s) => s.documents.map((d) => d.type.toLowerCase())));

interface ValidationForm {
  doc: FaDocument;
  isVerified: 'Yes' | 'No' | '';
  sourceOfValidation: string;
  remarks: string;
  file: File | null;
  submitted: boolean;
}

interface DecisionForm {
  decision: 'approve' | 'reject';
  comments: string;
  confirmed: boolean;
}

/**
 * One MSME's financial assistance application(s) for the master admin, the allotted agency and the
 * assigned financial assessor. Port of Views/FinancialAssistance/Verification.cshtml: documents
 * (opened through the API, which records when the assessor views them), validation of each document,
 * the assessor's and agency's decisions, and the reimbursement bank account.
 */
@Component({
  selector: 'zed-staff-fa-verification',
  imports: [FormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './fa-verification.html',
  styles: `
    table tbody tr td { font-size: 14px; }
    .w-50 { width: 50%; }
    .doc-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
    .preview img { max-width: 100%; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .help-block { color: #a94442; font-size: 13px; }
  `,
})
export class FaVerificationPage {
  private readonly api = inject(FaApi);
  private readonly route = inject(ActivatedRoute);
  private readonly user = inject(AuthService).currentUser;

  protected readonly sections = SECTIONS;
  protected readonly zedId = this.route.snapshot.paramMap.get('zedId') ?? '';
  protected readonly isAssessor = computed(() => this.user()?.roleId === StaffRole.DesktopAssessor);
  protected readonly isAgency = computed(() => this.user()?.roleId === StaffRole.Agency);

  protected readonly applications = signal<FaApplication[]>([]);
  protected readonly selected = signal<string>(this.route.snapshot.queryParamMap.get('certification') ?? '');
  protected readonly current = computed(() => {
    const apps = this.applications();
    return apps.find((a) => a.certification.toLowerCase() === this.selected().toLowerCase()) ?? apps[apps.length - 1] ?? null;
  });
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly preview = signal<string | null>(null);
  protected readonly validation = signal<ValidationForm | null>(null);
  protected readonly decision = signal<DecisionForm | null>(null);
  protected readonly account = signal<FaAccount | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);
  /** Documents the assessor opened in this visit (the API records it; the list is reloaded on the next action). */
  private readonly openedHere = signal<ReadonlySet<number>>(new Set());

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.applications.set(await firstValueFrom(this.api.details(this.zedId)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected value(app: FaApplication, key: string): string {
    const v = app.details[key];
    return v === null || v === undefined ? '' : String(v);
  }

  protected docsOf(app: FaApplication, type: string): FaDocument[] {
    return app.documents.filter((d) => (d.photoType ?? '').toLowerCase() === type.toLowerCase());
  }

  protected otherDocs(app: FaApplication): FaDocument[] {
    return app.documents.filter((d) => !KNOWN_TYPES.has((d.photoType ?? '').toLowerCase()));
  }

  protected opened(doc: FaDocument): boolean {
    return doc.opened || this.openedHere().has(doc.id);
  }

  protected viewed(doc: FaDocument): void {
    this.openedHere.update((s) => new Set([...s, doc.id]));
  }

  protected showImage(doc: FaDocument): void {
    this.viewed(doc);
    this.preview.set(doc.url);
  }

  protected status(app: FaApplication): number {
    return Number(app.details['VerificationStatus'] ?? 0);
  }

  protected isApproved(app: FaApplication): number {
    return Number(app.details['IsApproved'] ?? 0);
  }

  /** Banner of the old page: the assessor saw ACCEPTED/REJECTED, the agency ACCEPTED once approved. */
  protected outcome(app: FaApplication): 'accepted' | 'rejected' | null {
    const s = this.status(app);
    if (this.isAssessor()) return this.isApproved(app) === 2 || s === FaStatus.Rejected ? 'rejected' : s >= FaStatus.Qc ? 'accepted' : null;
    if (this.isAgency()) return s >= FaStatus.Approved && s !== FaStatus.Rejected ? 'accepted' : null;
    return null;
  }

  // ----- validation of a document -----

  protected openValidation(doc: FaDocument): void {
    this.success.set('');
    this.dialogError.set('');
    this.validation.set({
      doc,
      isVerified: doc.isVerified === 'Yes' || doc.isVerified === 'No' ? doc.isVerified : '',
      sourceOfValidation: doc.sourceOfValidation ?? '',
      remarks: doc.assessorRemarks ?? '',
      file: null,
      submitted: false,
    });
  }

  protected patchValidation(patch: Partial<ValidationForm>): void {
    const v = this.validation();
    if (v) this.validation.set({ ...v, ...patch });
  }

  protected needsScreenshot(v: ValidationForm): boolean {
    return v.isVerified === 'Yes' && (v.doc.photoType ?? '').toLowerCase() === 'copy of certificate';
  }

  protected pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file && (file.size > MAX_SCREENSHOT_BYTES || !/\.(pdf|jpe?g|png)$/i.test(file.name))) {
      this.dialogError.set('Please upload valid document (PDF / JPG / PNG, less than 2 MB).');
      input.value = '';
      this.patchValidation({ file: null });
      return;
    }
    this.dialogError.set('');
    this.patchValidation({ file });
  }

  protected async saveValidation(app: FaApplication): Promise<void> {
    const v = this.validation();
    if (!v) return;
    this.patchValidation({ submitted: true });
    if (!v.isVerified) return this.dialogError.set('Please select whether the document is verified.');
    if (v.isVerified === 'No' && !v.remarks.trim()) return this.dialogError.set('Please enter the remarks.');
    if (this.needsScreenshot(v)) {
      if (!v.sourceOfValidation.trim()) return this.dialogError.set('Please enter the source of validation.');
      if (!v.file && v.doc.screenshots.length === 0) return this.dialogError.set('Please upload valid pdf document.');
    }
    await this.run(
      () =>
        this.api.validate(this.zedId, app.certification, v.doc.id, {
          isVerified: v.isVerified as 'Yes' | 'No',
          sourceOfValidation: this.needsScreenshot(v) ? v.sourceOfValidation.trim() : '',
          remarks: v.remarks.trim(),
          file: this.needsScreenshot(v) ? v.file : null,
        }),
      () => this.validation.set(null),
    );
  }

  // ----- final decision -----

  /** REJECT asks for comments and a confirmation ("Confirm Final Submit"); ACCEPT submitted straight away on the old page. */
  protected async openDecision(app: FaApplication, decision: 'approve' | 'reject'): Promise<void> {
    this.success.set('');
    this.dialogError.set('');
    if (decision === 'reject') {
      this.decision.set({ decision, comments: '', confirmed: false });
      return;
    }
    if (this.saving()) return;
    await this.run(() => this.api.decide(this.zedId, app.certification, 'approve', ''), () => undefined, (message) => this.error.set(message));
  }

  protected patchDecision(patch: Partial<DecisionForm>): void {
    const d = this.decision();
    if (d) this.decision.set({ ...d, ...patch });
  }

  protected async saveDecision(app: FaApplication): Promise<void> {
    const d = this.decision();
    if (!d || !d.confirmed) return;
    if (d.decision === 'reject' && !d.comments.trim()) return this.dialogError.set('Please enter the comments.');
    await this.run(() => this.api.decide(this.zedId, app.certification, d.decision, d.comments.trim()), () => this.decision.set(null));
  }

  // ----- bank account -----

  protected editAccount(app: FaApplication): void {
    this.success.set('');
    this.error.set('');
    this.account.set({
      accountNo: this.value(app, 'AccountNo'),
      ifscCode: this.value(app, 'IfscCode'),
      branchAddress: this.value(app, 'BranchAddress'),
      bankName: this.value(app, 'BankName'),
    });
  }

  protected patchAccount(patch: Partial<FaAccount>): void {
    const a = this.account();
    if (a) this.account.set({ ...a, ...patch });
  }

  protected async saveAccount(app: FaApplication): Promise<void> {
    const a = this.account();
    if (!a) return;
    if (!a.accountNo.trim() || !a.ifscCode.trim() || !a.branchAddress.trim() || !a.bankName.trim()) {
      this.error.set('All fields are mandatory');
      return;
    }
    await this.run(
      () => this.api.updateAccount(this.zedId, app.certification, {
        accountNo: a.accountNo.trim(), ifscCode: a.ifscCode.trim(), branchAddress: a.branchAddress.trim(), bankName: a.bankName.trim(),
      }),
      () => this.account.set(null),
      (message) => this.error.set(message),
    );
  }

  protected closeDialogs(): void {
    if (this.saving()) return;
    this.validation.set(null);
    this.decision.set(null);
    this.preview.set(null);
  }

  /** Runs an action, then reloads the application (statuses and permissions come from the API). */
  private async run(
    action: () => ReturnType<FaApi['decide']>,
    done: () => void,
    fail: (message: string) => void = (m) => this.dialogError.set(m),
  ): Promise<void> {
    this.saving.set(true);
    this.dialogError.set('');
    try {
      const r = await firstValueFrom(action());
      done();
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      fail(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
