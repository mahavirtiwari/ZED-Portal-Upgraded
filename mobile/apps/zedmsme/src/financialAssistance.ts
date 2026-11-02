/**
 * The Financial Assistance claim of the MSME code base (models/Models.kt FinancialAssistance, CertificationInfo,
 * ExpenditureInfo, AccountInfo): the JSON names of Msme/SubmitFinancialData, and the rules of isValid().
 */
import type { PhotoData } from '@zed/shared';

export const CATEGORIES = ['Quality', 'Product', 'Testing'] as const;

/** "Eligible Financial Assistance: 75% of invoice amount and max. up to 50,000 only" (the server computes its own). */
export const MAX_ELIGIBLE = 50_000;

export type CertificationInfo = {
  CategoryOfCertificate?: string | null;
  NameOfCertficate?: string | null;
  CertificationAgency?: string | null;
  CertficateNumber?: string | null;
  DateOfIssue?: string | null;
  ValidityOfCertificate?: string | null;
  Photos: PhotoData[];
};

export type ExpenditureInfo = {
  ExpenditureCertficate?: string | null;
  AgencyOrSupplier?: string | null;
  InvoiceNo?: string | null;
  InvoiceBillDate?: string | null;
  DescriptionOfExpenses?: string | null;
  AmountPaid?: string | null;
  ModeOfPayment?: string | null;
  EligibleAmount?: string | null;
  Photos: PhotoData[];
  InvoicePhotos: PhotoData[];
};

export type AccountInfo = {
  AccountNo?: string | null;
  IfscCode?: string | null;
  BranchAddress?: string | null;
  BankName?: string | null;
  Photos: PhotoData[];
};

export type FinancialAssistance = {
  ZedId: string;
  CertificationDetails: CertificationInfo;
  ExpenditureDetails: ExpenditureInfo;
  AccountDetails: AccountInfo;
};

export function newFinancialAssistance(zedId: string): FinancialAssistance {
  return {
    ZedId: zedId,
    CertificationDetails: { Photos: [] },
    ExpenditureDetails: { Photos: [], InvoicePhotos: [] },
    AccountDetails: { Photos: [] },
  };
}

const filled = (...values: Array<string | null | undefined>) => values.every(v => v != null && v.trim() !== '');

export const certificationIsValid = (c: CertificationInfo) =>
  filled(c.CategoryOfCertificate, c.NameOfCertficate, c.CertificationAgency, c.CertficateNumber, c.DateOfIssue, c.ValidityOfCertificate) && c.Photos.length > 0;

export const expenditureIsValid = (e: ExpenditureInfo) =>
  filled(e.ExpenditureCertficate, e.AgencyOrSupplier, e.InvoiceNo, e.InvoiceBillDate, e.DescriptionOfExpenses, e.AmountPaid, e.ModeOfPayment, e.EligibleAmount) &&
  e.Photos.length > 0 &&
  e.InvoicePhotos.length > 0;

export const accountIsValid = (a: AccountInfo) => filled(a.AccountNo, a.IfscCode, a.BranchAddress, a.BankName) && a.Photos.length > 0;

export const financialAssistanceIsValid = (f: FinancialAssistance) =>
  f.ZedId.trim() !== '' && certificationIsValid(f.CertificationDetails) && expenditureIsValid(f.ExpenditureDetails) && accountIsValid(f.AccountDetails);

/** min(0.75 x the whole rupees paid, 50,000), as the server computes it (MsmeController.SubmitFinancialData); '' for no amount. */
export function eligibleAmount(amountPaid: string | null | undefined): string {
  const amount = Number((amountPaid ?? '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const eligible = Math.min(Math.trunc(amount) * 0.75, MAX_ELIGIBLE);
  return String(Math.round(eligible * 100) / 100);
}
