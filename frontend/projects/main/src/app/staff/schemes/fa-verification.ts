import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { StaffRole } from '../staff-menu';
import { FaAccount, FaApi, FaApplication, FaDocument, FaStatus } from './fa.api';
import { TextPipe, t } from '../../content/page-text';

export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

interface Section {
  title: string;
  /** `prefix`: shown before the value, as the old page's "Rs." amounts. */
  fields: { label: string; key: string; prefix?: string }[];
  documents: { label: string; type: string }[];
  account?: boolean;
}

/**
 * The three sections of the old page, with the document types the MSME app uploads for each. The wording is read when shown
 * (getters: the Admin's, Texts → Page wording, staff.faVerification.*, or the standard one); the keys and types stay the code values.
 */
const SECTIONS: Section[] = [
  {
    get title() { return t('staff.faVerification.certification.title', 'Certification Details'); },
    fields: [
      { get label() { return t('staff.faVerification.certification.category.label', 'Category of Certificate'); }, key: 'CategoryOfCertificate' },
      { get label() { return t('staff.faVerification.certification.name.label', 'Name of Certificate'); }, key: 'NameOfCertficate' },
      { get label() { return t('staff.faVerification.certification.agency.label', 'Name of Certification Agency'); }, key: 'CertificationAgency' },
      { get label() { return t('staff.faVerification.certification.number.label', 'Certificate Number'); }, key: 'CertficateNumber' },
      { get label() { return t('staff.faVerification.certification.issued.label', 'Date of Issue of Certificate'); }, key: 'DateOfIssue' },
      { get label() { return t('staff.faVerification.certification.validity.label', 'Period of validity of Certificate'); }, key: 'ValidityOfCertificate' },
      { get label() { return t('staff.faVerification.certification.other.label', 'Any other information related to this certificate'); }, key: 'AnyOtherInformation' },
    ],
    documents: [{ get label() { return t('staff.faVerification.certification.copy.label', 'Copy of Certificate'); }, type: 'Copy of Certificate' }],
  },
  {
    get title() { return t('staff.faVerification.expenditure.title', 'Details of Expenditure'); },
    fields: [
      { get label() { return t('staff.faVerification.expenditure.certificate.label', 'Name of Certificate'); }, key: 'ExpenditureCertficate' },
      { get label() { return t('staff.faVerification.expenditure.supplier.label', 'Name of Agency/Supplier'); }, key: 'AgencyOrSupplier' },
      { get label() { return t('staff.faVerification.expenditure.invoiceNo.label', 'Invoice/Bill No.'); }, key: 'InvoiceNo' },
      { get label() { return t('staff.faVerification.expenditure.invoiceDate.label', 'Invoice Bill Date'); }, key: 'InvoiceBillDate' },
      { get label() { return t('staff.faVerification.expenditure.amountPaid.label', 'Amount Paid(Rs.)'); }, key: 'AmountPaid', prefix: 'Rs.' },
      { get label() { return t('staff.faVerification.expenditure.eligible.label', 'Eligible Financial Assistance(Rs.)'); }, key: 'EligibleAmount', prefix: 'Rs.' },
      { get label() { return t('staff.faVerification.expenditure.mode.label', 'Mode of Payment'); }, key: 'ModeOfPayment' },
    ],
    // Order and labels of the old page: the CA certificate row came before the invoice.
    documents: [
      { get label() { return t('staff.faVerification.expenditure.caCertificate.label', 'CA certificate of expenditure (Optional)'); }, type: 'CA certificate of expenditure' },
      { get label() { return t('staff.faVerification.expenditure.invoiceCopy.label', 'Invoice Copy'); }, type: 'Copy of Invoice' },
    ],
  },
  {
    get title() { return t('staff.faVerification.account.title', 'Account Details of Reimbursement'); },
    fields: [
      { get label() { return t('staff.faVerification.account.number.label', 'Account No.'); }, key: 'AccountNo' },
      { get label() { return t('staff.faVerification.account.ifsc.label', 'IFSC Code'); }, key: 'IfscCode' },
      { get label() { return t('staff.faVerification.account.branch.label', 'Branch Address'); }, key: 'BranchAddress' },
      { get label() { return t('staff.faVerification.account.bank.label', 'Name of the Bank'); }, key: 'BankName' },
    ],
    documents: [{ get label() { return t('staff.faVerification.account.cheque.label', 'Cancelled Cheque Copy'); }, type: 'Copy of Cancelled Cheque' }],
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
 * 2026-11-19 ("All page wording"): every wording is the Admin's (Texts → Page wording, staff.faVerification.*) or the standard one
 * here and in fa-verification.html; the data-correct pledge stays an HTML text (zed-text).
 */
@Component({
  selector: 'zed-staff-fa-verification',
  imports: [FormsModule, RouterLink, NgTemplateOutlet, ContentTextComponent, PageHead, TextPipe],
  templateUrl: './fa-verification.html',
  styles: `
    .section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; }
    .section-head h4 { font-size: 16px; font-weight: 700; color: #23474a; margin: 0; }
    .table-responsive { margin-bottom: 0; }
    .details { margin-bottom: 0; }
    .details td { font-size: 14px; }
    .w-50 { width: 50%; color: #3b4b4c; }
    .w-30 { width: 30%; }
    .doc-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
    .doc-status { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .doc-status .remarks { word-break: break-word; }
    .doc-status .shots { display: flex; flex-wrap: wrap; gap: 4px; }
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
  /** 2026-11-17 (approved staff redesign): "Home > Financial Assistance > ZED ID". */
  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.faVerification.crumb', 'Financial Assistance'), link: '/staff/financial-assistance' }, { label: this.zedId }));
  private readonly toast = inject(ToastService);
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
  protected readonly preview = signal<string | null>(null);
  protected readonly validation = signal<ValidationForm | null>(null);
  protected readonly decision = signal<DecisionForm | null>(null);
  protected readonly account = signal<FaAccount | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);
  /** Documents the assessor opened in this visit (the API records it; the list is reloaded on the next action). */
  private readonly openedHere = signal<ReadonlySet<number>>(new Set());
  /** Documents whose remarks are unfolded (long remarks show three lines). */
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  constructor() {
    void this.load();
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
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
      this.dialogError.set(t('staff.faVerification.validate.fileError', 'Please upload valid document (PDF / JPG / PNG, less than 2 MB).'));
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
    if (!v.isVerified) return this.dialogError.set(t('staff.faVerification.validate.verifiedError', 'Please select whether the document is verified.'));
    if (v.isVerified === 'No' && !v.remarks.trim()) return this.dialogError.set(t('staff.faVerification.validate.remarksError', 'Please enter the remarks.'));
    if (this.needsScreenshot(v)) {
      if (!v.sourceOfValidation.trim()) return this.dialogError.set(t('staff.faVerification.validate.sourceError', 'Please enter the source of validation.'));
      if (!v.file && v.doc.screenshots.length === 0) return this.dialogError.set(t('staff.faVerification.validate.screenshotError', 'Please upload valid pdf document.'));
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
    if (d.decision === 'reject' && !d.comments.trim()) return this.dialogError.set(t('staff.faVerification.decision.commentsError', 'Please enter the comments.'));
    await this.run(() => this.api.decide(this.zedId, app.certification, d.decision, d.comments.trim()), () => this.decision.set(null));
  }

  // ----- bank account -----

  protected editAccount(app: FaApplication): void {
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
      this.error.set(t('staff.faVerification.account.requiredError', 'All fields are mandatory'));
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
      this.toast.success(r.message);
      await this.load();
    } catch (err) {
      fail(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
