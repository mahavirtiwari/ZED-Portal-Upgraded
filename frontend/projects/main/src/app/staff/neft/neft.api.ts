import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

export type NeftList = 'new' | 'approved' | 'rejected';

/** A FinancialAssistance reimbursement, with the column names of SP_NEFT_TRANSACTIONS_BY_STATUS. */
export interface NeftTransaction {
  TransactionId: number;
  ZedId: string;
  PUnitName: string | null;
  EnterpriseName: string | null;
  CertificationType: string | null;
  /** Consultancy (Technology Upgradation reimbursements). */
  TechnologyName?: string | null;
  NameOfTheManufacturer?: string | null;
  MakeOrModelName?: string | null;
  TotalPaidAfterQc?: string | number | null;
  CertId?: string | null;
  TechUpgradeStatus?: number | string | null;
  CategoryOfCertificate: string | null;
  NameOfCertficate: string | null;
  CertificationAgency: string | null;
  CertficateNumber: string | null;
  DateOfIssue: string | null;
  ValidityOfCertificate: string | null;
  ExpenditureCertficate: string | null;
  AgencyOrSupplier: string | null;
  InvoiceNo: string | null;
  InvoiceBillDate: string | null;
  AmountPaid: string | null;
  EligibleAmount: string | null;
  AccountNo: string | null;
  IfscCode: string | null;
  BranchAddress: string | null;
  BankName: string | null;
  VerificationStatus: number | null;
  TransactionStatus: number | null;
  ApproverDateOfReceiptOfPayment: string | null;
  ApproverReferenceNo: string | null;
  ApproverAmount: number | string | null;
  Comments: string | null;
}

export interface NeftApproval {
  zedId: string;
  /** yyyy-MM-dd */
  dateOfReceiptOfPayment: string;
  referenceNo: string;
  amount: string;
}

/** Client for api/staff/neft (Zed.Main.Api NeftController). */
@Injectable({ providedIn: 'root' })
export class NeftApi {
  private readonly http = inject(HttpClient);

  list(list: NeftList): Observable<{ transactions: NeftTransaction[] }> {
    return this.http.get<{ transactions: NeftTransaction[] }>('/api/staff/neft/transactions', { params: new HttpParams().set('list', list) });
  }

  approve(transactionId: number, body: NeftApproval): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`/api/staff/neft/transactions/${transactionId}/approve`, body);
  }
}
