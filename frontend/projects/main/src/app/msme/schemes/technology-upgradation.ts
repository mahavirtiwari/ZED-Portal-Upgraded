import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { AlertDialog, AlertMessage, errorAlert } from '../shared/alert-dialog';
import { fieldError } from '../shared/field-error';
import { SchemeDocumentField, SchemeIntro, SchemeUnitPanel } from './scheme-parts';
import {
  SchemeAccount, SchemeDocument, SchemesApi, TuPage, TuTechnology, TuTechnologySubmission, inr, toInputDate, todayIso, uploadProblem,
} from './schemes.api';

export const TU_DOCUMENTS = {
  purchased: 'Purchased Technology',
  invoice: 'Copy of Invoice',
  ca: 'CA certificate of expenditure',
  cheque: 'Copy of Cancelled Cheque',
} as const;

type Step = 1 | 2 | 3 | 'list' | 'technology' | 'summary' | 'account' | 'done';

type TechnologyForm = Omit<TuTechnologySubmission, 'documents'>;

/**
 * Financial support for Zero Effect Solutions (technology upgradation after Handholding milestone 3).
 * Port of Frontend/TechnologyUpgradation/Index.cshtml: disclaimer, instructions, unit confirmation, the
 * recommended technologies (apply / view each), the summary of amounts, then the bank account.
 */
@Component({
  selector: 'zed-msme-technology-upgradation',
  imports: [FormsModule, RouterLink, SchemeUnitPanel, SchemeIntro, SchemeDocumentField, AlertDialog, ContentTextComponent],
  templateUrl: './technology-upgradation.html',
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .btn-disabled { opacity: .5; }
  `,
})
export class TechnologyUpgradationPage {
  private readonly api = inject(SchemesApi);

  protected readonly docTypes = TU_DOCUMENTS;
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  /** Error pop-up (the legacy swal). */
  protected readonly alert = signal<AlertMessage | null>(null);
  protected readonly page = signal<TuPage | null>(null);
  protected readonly step = signal<Step>(1);
  protected readonly confirmed = signal(false);
  protected readonly current = signal<TuTechnology | null>(null);
  /** Documents of the technology being edited. */
  protected readonly techDocs = signal<SchemeDocument[]>([]);
  protected readonly chequeDocs = signal<SchemeDocument[]>([]);
  protected readonly today = todayIso();
  protected readonly inr = inr;
  protected readonly fieldError = fieldError;

  protected readonly unit = computed(() => this.page()?.unit ?? {});
  protected readonly technologies = computed(() => this.page()?.technologies ?? []);
  protected readonly anySubmitted = computed(() => this.technologies().some((t) => t.submitted));
  protected readonly minDate = computed(() => this.page()?.minDate ?? '');

  protected tech: TechnologyForm = this.emptyTechnology();
  protected account: SchemeAccount = { accountNo: '', confirmAccountNo: '', ifscCode: '', branchAddress: '', bankName: '' };
  protected declaration = false;

  constructor() {
    void this.load();
  }

  protected go(step: Step): void {
    this.step.set(step);
    window.scrollTo?.(0, 0);
  }

  protected docs(list: SchemeDocument[], type: string): SchemeDocument[] {
    return list.filter((d) => d.type === type);
  }

  /** Apply (new) or view/edit (submitted) one technology, as the APPLY / VIEW buttons. */
  protected open(t: TuTechnology): void {
    this.current.set(t);
    const d = t.details;
    this.tech = d
      ? {
          nameOfTheManufaturer: String(d['NameOfTheManufaturer'] ?? ''),
          makeOrModelName: String(d['MakeOrModelName'] ?? ''),
          dateOfPurchase: toInputDate(d['DateOfPurchase']),
          agencyOrSupplier: String(d['AgencyOrSupplier'] ?? ''),
          invoiceNo: String(d['InvoiceNo'] ?? ''),
          invoiceBillDate: toInputDate(d['InvoiceBillDate']),
          amountPaid: d['AmountPaid'] === null || d['AmountPaid'] === '' ? null : Number(d['AmountPaid']),
          modeOfPayment: String(d['ModeOfPayment'] ?? ''),
        }
      : this.emptyTechnology();
    this.techDocs.set(d ? [...t.documents] : []);
    this.go('technology');
  }

  protected async upload(target: 'tech' | 'cheque', type: string, file: File): Promise<void> {
    const problem = uploadProblem(file);
    if (problem) {
      this.alert.set(errorAlert(problem));
      return;
    }
    this.busy.set(true);
    try {
      const doc = await firstValueFrom(this.api.upload('tu', type, file));
      (target === 'tech' ? this.techDocs : this.chequeDocs).update((list) => [...list, doc]);
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
    } finally {
      this.busy.set(false);
    }
  }

  protected remove(target: 'tech' | 'cheque', fileName: string): void {
    (target === 'tech' ? this.techDocs : this.chequeDocs).update((list) => list.filter((d) => d.fileName !== fileName));
  }

  protected async saveTechnology(): Promise<void> {
    const t = this.current();
    if (!t) return;
    const f = this.tech;
    const required = [f.nameOfTheManufaturer, f.makeOrModelName, f.dateOfPurchase, f.agencyOrSupplier, f.invoiceNo, f.invoiceBillDate, f.modeOfPayment];
    if (required.some((v) => !String(v ?? '').trim()) || !f.amountPaid) {
      this.alert.set(errorAlert('Please enter required data.'));
      return;
    }
    if (!this.docs(this.techDocs(), TU_DOCUMENTS.purchased).length || !this.docs(this.techDocs(), TU_DOCUMENTS.invoice).length) {
      this.alert.set(errorAlert('Please upload the required documents.'));
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.submitTechnology(t.code, {
        ...f,
        documents: this.techDocs().map((d) => ({ fileName: d.fileName, type: d.type ?? '' })),
      }));
      this.page.set(await firstValueFrom(this.api.tuPage()));
      this.go('list');
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
    } finally {
      this.busy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const a = this.account;
    if (![a.accountNo, a.confirmAccountNo, a.ifscCode, a.branchAddress, a.bankName].every((v) => v.trim())) {
      this.alert.set(errorAlert('Please enter required data.'));
      return;
    }
    if (a.accountNo.trim() !== a.confirmAccountNo.trim()) {
      this.alert.set(errorAlert('Account Number and Re-Enter Account Number must match.'));
      return;
    }
    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(a.ifscCode.trim())) {
      this.alert.set(errorAlert('Invalid IFSC code format.'));
      return;
    }
    if (!this.chequeDocs().length) {
      this.alert.set(errorAlert('Please upload the required documents.'));
      return;
    }
    if (!this.declaration) {
      this.alert.set(errorAlert('Please accept the declaration.'));
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.submitTu({
        account: a,
        documents: this.chequeDocs().map((d) => ({ fileName: d.fileName, type: d.type ?? '' })),
        declaration: true,
      }));
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
      this.page.set(await firstValueFrom(this.api.tuPage()));
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
    } finally {
      this.loading.set(false);
    }
  }

  private emptyTechnology(): TechnologyForm {
    return {
      nameOfTheManufaturer: '', makeOrModelName: '', dateOfPurchase: '', agencyOrSupplier: '', invoiceNo: '', invoiceBillDate: '',
      amountPaid: null, modeOfPayment: '',
    };
  }
}
