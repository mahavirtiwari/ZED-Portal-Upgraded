import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../../content/content-text';
import { StaffRole } from '../../staff-menu';
import { TuAccount, TuApi, TuApplication, TuDocument, TuMeeting, TuTechnology, TuValues } from './tu.api';

export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

/** The purchase details of a technology; the amounts and the mode of payment follow them on the page. */
export const TECHNOLOGY_FIELDS: { label: string; key: string }[] = [
  { label: 'Name of Manufacturer', key: 'NameOfTheManufaturer' },
  { label: 'Make / Model Name', key: 'MakeOrModelName' },
  { label: 'Date of Purchase', key: 'DateOfPurchase' },
  { label: 'Name of Agency/Supplier', key: 'AgencyOrSupplier' },
  { label: 'Invoice/Bill No.', key: 'InvoiceNo' },
  { label: 'Invoice Bill Date', key: 'InvoiceBillDate' },
];

/** Bronze: the certificate the MSME obtained (the old page's Name of Certificate row is commented out there). */
export const BRONZE_CERTIFICATE_FIELDS: { label: string; key: string }[] = [
  { label: 'Category of Certificate', key: 'CategoryOfCertificate' },
  { label: 'Name of Certification Agency', key: 'CertificationAgency' },
  { label: 'Certificate Number', key: 'CertficateNumber' },
  { label: 'Date of Issue of Certificate', key: 'DateOfIssue' },
  { label: 'Period of validity of Certificate', key: 'ValidityOfCertificate' },
  { label: 'Any other information related to this certificate', key: 'AnyOtherInformation' },
];

/** Bronze: the "Details of Expenditure" before the amounts and the mode of payment. */
export const BRONZE_EXPENDITURE_FIELDS: { label: string; key: string }[] = [
  { label: 'Name of Agency/Supplier', key: 'AgencyOrSupplier' },
  { label: 'Invoice/Bill No.', key: 'InvoiceNo' },
  { label: 'Invoice Bill Date', key: 'InvoiceBillDate' },
];

const CERTIFICATE_COPY = 'Copy of Certificate';

/** The document rows of a technology and of the account, in the old page's order and captions (by PhotoType). */
export const TECHNOLOGY_DOCUMENTS: { label: string; type: string }[] = [
  { label: 'CA certificate of expenditure', type: 'CA certificate of expenditure' },
  { label: 'Purchased Technology', type: 'Purchased Technology' },
  { label: 'Invoice Copy', type: 'Copy of Invoice' },
];
export const ACCOUNT_DOCUMENTS: { label: string; type: string }[] = [{ label: 'Cancelled Cheque Copy', type: 'Copy of Cancelled Cheque' }];

/** The opening meeting photo; the app's other meeting photos are the site's interior and exterior. */
const OPENING_MEETING_PHOTO = 'Opening Meeting Photo';

export interface DocumentGroup {
  label: string;
  docs: TuDocument[];
}

/** The listed rows (even when empty, as on the old page), then any other document type under its own name. */
function groupDocuments(docs: TuDocument[], rows: { label: string; type: string }[]): DocumentGroup[] {
  const known = new Set(rows.map((r) => r.type.toLowerCase()));
  const groups = rows.map((r) => ({ label: r.label, docs: docs.filter((d) => (d.photoType ?? '').toLowerCase() === r.type.toLowerCase()) }));
  const others = new Map<string, TuDocument[]>();
  for (const d of docs) {
    const type = d.photoType ?? '';
    if (known.has(type.toLowerCase())) continue;
    others.set(type, [...(others.get(type) ?? []), d]);
  }
  return [...groups, ...[...others].map(([label, list]) => ({ label, docs: list }))];
}

function isCertificateCopy(d: TuDocument): boolean {
  return (d.photoType ?? '').toLowerCase() === CERTIFICATE_COPY.toLowerCase();
}

export const ACCOUNT_FIELDS: { label: string; key: keyof TuAccount; column: string; max: number }[] = [
  { label: 'Account No.', key: 'accountNo', column: 'AccountNo', max: 18 },
  { label: 'IFSC Code', key: 'ifscCode', column: 'IfscCode', max: 11 },
  { label: 'Branch Address', key: 'branchAddress', column: 'BranchAddress', max: 500 },
  { label: 'Name of the Bank', key: 'bankName', column: 'BankName', max: 200 },
];

interface ValidationForm {
  doc: TuDocument;
  isVerified: 'Yes' | 'No' | '';
  sourceOfValidation: string;
  remarks: string;
  file: File | null;
}

interface DecisionForm {
  decision: 'approve' | 'reject';
  comments: string;
  confirmed: boolean;
}

/**
 * One unit's Technology Upgradation application for the master admin, the allotted CO, the assigned MSME-DFO officer
 * and the state coordinator (from the NEFT lists). Port of Frontend/FinancialAssistance/Verification.cshtml: a tab per
 * certification level with the old page's collapsible sections (the DFO's attendance, the site photos and the opening
 * meeting from the app, each purchased technology with its documents and the DFO's validation (Bronze: the certificate
 * and its Details of Expenditure; Gold: all under "New tech with live sectors"), the payout account, the summary with
 * the eligible amount), then the unit's Overview and the Technologies Recommended tabs; the decisions of the CO and the
 * master admin (the DFO decides from the app and sees only the outcome) and the TU report (PDF).
 * Route: /staff/consultancy/technology/verification/:zedId/:level
 */
@Component({
  selector: 'zed-staff-tu-verification',
  imports: [FormsModule, RouterLink, NgTemplateOutlet, ContentTextComponent],
  templateUrl: './tu-verification.html',
  styles: `
    table tbody tr td { font-size: 14px; }
    .w-50 { width: 50%; }
    .doc-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
    .thumb { max-width: 60px; max-height: 60px; margin-right: 6px; }
    .section-toggle { cursor: pointer; }
    .section-toggle .registration-title { color: #fff; margin: 0; font-size: 16px; }
    .preview img { max-width: 100%; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class TuVerificationPage {
  private readonly api = inject(TuApi);
  private readonly route = inject(ActivatedRoute);
  private readonly user = inject(AuthService).currentUser;

  protected readonly bronzeCertificateFields = BRONZE_CERTIFICATE_FIELDS;
  protected readonly accountFields = ACCOUNT_FIELDS;
  protected readonly zedId = this.route.snapshot.paramMap.get('zedId') ?? '';
  protected readonly level = this.route.snapshot.paramMap.get('level') ?? '';
  protected readonly isCoordinator = computed(() => this.user()?.roleId === StaffRole.StateCoordinator);

  protected readonly applications = signal<TuApplication[]>([]);
  protected readonly selected = signal(this.level);
  protected readonly current = computed(() => {
    const apps = this.applications();
    return apps.find((a) => a.certification.toLowerCase() === this.selected().toLowerCase()) ?? apps[apps.length - 1] ?? null;
  });
  /** The open tab: a certification level, 'overview' or 'recommended'; the application's level at first. */
  private readonly tabChoice = signal<string | null>(null);
  protected readonly tab = computed(() => this.tabChoice() ?? this.current()?.certification ?? 'overview');
  /** Open sections of the level's accordion (all closed at first, as on the old page). */
  private readonly openSections = signal<ReadonlySet<string>>(new Set());
  protected readonly overview = computed(() => this.applications().find((a) => a.overview)?.overview ?? null);
  protected readonly location = computed(() => this.applications().find((a) => a.location)?.location ?? null);
  protected readonly recommended = computed(() => this.applications().flatMap((a) => a.recommended));
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly preview = signal<string | null>(null);
  protected readonly validation = signal<ValidationForm | null>(null);
  protected readonly decision = signal<DecisionForm | null>(null);
  protected readonly account = signal<TuAccount | null>(null);
  protected readonly amountEdit = signal<{ id: number; value: string } | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);
  private readonly openedHere = signal<ReadonlySet<number>>(new Set());

  constructor() {
    void this.load();
  }

  protected get backLink(): string {
    return this.isCoordinator() ? '/staff/neft/new' : '/staff/consultancy/technology';
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

  protected value(values: Record<string, unknown> | null, key: string): string {
    const v = values?.[key];
    return v === null || v === undefined ? '' : String(v);
  }

  protected selectTab(tab: string): void {
    this.tabChoice.set(tab);
    if (this.applications().some((a) => a.certification === tab)) {
      this.selected.set(tab);
      this.openSections.set(new Set());
    }
  }

  protected isOpen(key: string): boolean {
    return this.openSections().has(key);
  }

  protected toggle(key: string): void {
    const open = new Set(this.openSections());
    if (open.has(key)) open.delete(key);
    else open.add(key);
    this.openSections.set(open);
  }

  protected mapUrl(location: TuValues | null): string {
    const lat = this.value(location, 'Latitude');
    const lng = this.value(location, 'Longitude');
    return lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}` : '';
  }

  protected openingPhotos(m: TuMeeting): TuMeeting['photos'] {
    return m.photos.filter((p) => p.name === OPENING_MEETING_PHOTO);
  }

  protected sitePhotos(m: TuMeeting): TuMeeting['photos'] {
    return m.photos.filter((p) => p.name !== OPENING_MEETING_PHOTO);
  }

  protected isBronze(app: TuApplication): boolean {
    return app.certification.toLowerCase() === 'bronze';
  }

  protected isGold(app: TuApplication): boolean {
    return app.certification.toLowerCase() === 'gold';
  }

  /** The purchase details of a technology by level: on Bronze its Details of Expenditure, on Silver and Gold the machine bought. */
  protected fieldsFor(app: TuApplication): { label: string; key: string }[] {
    return this.isBronze(app) ? BRONZE_EXPENDITURE_FIELDS : TECHNOLOGY_FIELDS;
  }

  /** Bronze: the certificate copy is shown with the certificate, the other documents with the expenditure. */
  protected certificateDocumentRows(app: TuApplication, t: TuTechnology): DocumentGroup[] {
    return [{ label: CERTIFICATE_COPY, docs: this.docsOf(app, t).filter(isCertificateCopy) }];
  }

  protected documentRows(app: TuApplication, t: TuTechnology): DocumentGroup[] {
    const docs = this.docsOf(app, t);
    return groupDocuments(this.isBronze(app) ? docs.filter((d) => !isCertificateCopy(d)) : docs, TECHNOLOGY_DOCUMENTS);
  }

  protected accountDocumentRows(app: TuApplication): DocumentGroup[] {
    return groupDocuments(this.otherDocs(app), ACCOUNT_DOCUMENTS);
  }

  protected eligible(app: TuApplication): TuTechnology[] {
    return app.technologies.filter((t) => t.isEligible);
  }

  /** TotalPaidAfterQc once set, else the eligible technologies' verified amounts added up (the old page's calculateTotalExpenses). */
  protected totalAmount(app: TuApplication): string {
    const saved = this.value(app.details, 'TotalPaidAfterQc');
    return saved || String(this.eligible(app).reduce((sum, t) => sum + (parseFloat(this.value(t.details, 'AmountPaid')) || 0), 0));
  }

  /** The outcome line of the old page: the DFO sees its own decision (IsApproved), the CO the final approval (status 4). */
  protected statusAlert(app: TuApplication): 'ACCEPTED' | 'REJECTED' | null {
    const role = this.user()?.roleId;
    const approved = this.value(app.details, 'IsApproved');
    if (role === StaffRole.DesktopAssessor) return approved === '2' ? 'REJECTED' : approved === '1' ? 'ACCEPTED' : null;
    if (role === StaffRole.Agency) return this.value(app.details, 'VerificationStatus') === '4' ? 'ACCEPTED' : null;
    return null;
  }

  protected docsOf(app: TuApplication, t: TuTechnology): TuDocument[] {
    const code = this.value(t.details, 'TechnologyCode');
    return app.documents.filter((d) => d.technologyCode === code);
  }

  protected otherDocs(app: TuApplication): TuDocument[] {
    const codes = new Set(app.technologies.map((t) => this.value(t.details, 'TechnologyCode')));
    return app.documents.filter((d) => !d.technologyCode || !codes.has(d.technologyCode));
  }

  protected reportUrl(app: TuApplication): string {
    return this.api.reportUrl(this.zedId, app.certification);
  }

  protected opened(doc: TuDocument): boolean {
    return doc.opened || this.openedHere().has(doc.id);
  }

  protected viewed(doc: TuDocument): void {
    this.openedHere.update((s) => new Set([...s, doc.id]));
  }

  protected showImage(url: string, doc?: TuDocument): void {
    if (doc) this.viewed(doc);
    this.preview.set(url);
  }

  // ----- validation -----

  protected openValidation(doc: TuDocument): void {
    this.success.set('');
    this.dialogError.set('');
    this.validation.set({
      doc,
      isVerified: doc.isVerified === 'Yes' || doc.isVerified === 'No' ? doc.isVerified : '',
      sourceOfValidation: doc.sourceOfValidation ?? '',
      remarks: doc.assessorRemarks ?? '',
      file: null,
    });
  }

  protected patchValidation(patch: Partial<ValidationForm>): void {
    const v = this.validation();
    if (v) this.validation.set({ ...v, ...patch });
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

  protected async saveValidation(app: TuApplication): Promise<void> {
    const v = this.validation();
    if (!v) return;
    if (!v.isVerified) return this.dialogError.set('Please select whether the document is verified.');
    if (v.isVerified === 'No' && !v.remarks.trim()) return this.dialogError.set('Please enter the remarks.');
    if (v.isVerified === 'Yes' && v.doc.needsScreenshot && !v.file && v.doc.screenshots.length === 0)
      return this.dialogError.set('Please upload valid pdf document.');
    await this.run(
      () => this.api.validate(this.zedId, app.certification, v.doc.id, {
        isVerified: v.isVerified as 'Yes' | 'No',
        sourceOfValidation: v.sourceOfValidation.trim(),
        remarks: v.remarks.trim(),
        file: v.file,
      }),
      () => this.validation.set(null),
    );
  }

  // ----- amounts -----

  protected editAmount(t: TuTechnology): void {
    this.success.set('');
    this.error.set('');
    this.amountEdit.set({ id: t.id, value: this.value(t.details, 'AmountPaid') });
  }

  protected async saveAmount(app: TuApplication): Promise<void> {
    const a = this.amountEdit();
    if (!a) return;
    if (!/^\d+(\.\d{1,2})?$/.test(a.value.trim())) {
      this.error.set('Please enter a valid amount (up to 2 decimals).');
      return;
    }
    await this.run(() => this.api.updateAmount(this.zedId, app.certification, a.id, a.value.trim()), () => this.amountEdit.set(null), (m) => this.error.set(m));
  }

  // ----- decision -----

  protected openDecision(decision: 'approve' | 'reject'): void {
    this.success.set('');
    this.dialogError.set('');
    this.decision.set({ decision, comments: '', confirmed: false });
  }

  protected patchDecision(patch: Partial<DecisionForm>): void {
    const d = this.decision();
    if (d) this.decision.set({ ...d, ...patch });
  }

  protected async saveDecision(app: TuApplication): Promise<void> {
    const d = this.decision();
    if (!d || !d.confirmed) return;
    if (d.decision === 'reject' && !d.comments.trim()) return this.dialogError.set('Please enter the comments.');
    await this.run(() => this.api.decide(this.zedId, app.certification, d.decision, d.comments.trim()), () => this.decision.set(null));
  }

  // ----- account -----

  protected editAccount(app: TuApplication): void {
    this.success.set('');
    this.error.set('');
    this.account.set({
      accountNo: this.value(app.details, 'AccountNo'),
      ifscCode: this.value(app.details, 'IfscCode'),
      branchAddress: this.value(app.details, 'BranchAddress'),
      bankName: this.value(app.details, 'BankName'),
    });
  }

  protected patchAccount(key: keyof TuAccount, value: string): void {
    const a = this.account();
    if (a) this.account.set({ ...a, [key]: value });
  }

  protected async saveAccount(app: TuApplication): Promise<void> {
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
      (m) => this.error.set(m),
    );
  }

  protected closeDialogs(): void {
    if (this.saving()) return;
    this.validation.set(null);
    this.decision.set(null);
    this.preview.set(null);
  }

  private async run(
    action: () => ReturnType<TuApi['decide']>,
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
