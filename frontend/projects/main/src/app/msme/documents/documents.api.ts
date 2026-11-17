import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Rows of SP_MSME_GET_MY_DOCUMENTS with its column names. File columns hold `/api/msme/files/...`
 * links (or null when there is no file).
 */
export interface Guideline {
  DocumentName: string;
  DocumentPath: string | null;
  /** V4 (Admin → Documents/Videos): its description, and a video's address (no file then). */
  Description?: string | null;
  VideoUrl?: string | null;
}

export interface CertificateLinks {
  Pledge: string | null;
  Bronze: string | null;
  Silver: string | null;
  Gold: string | null;
  /** V4: ZED-X (a separate track, shown besides the highest of Bronze/Silver/Gold). */
  ZEDX?: string | null;
  /** 2026-11-08: the levels the Admin added, by code, as ZED-X. */
  [level: string]: string | null | undefined;
}

export interface Invoice {
  TadaInvoiceNo: string | null;
  InvoicePath: string | null;
  DocumentType: string | null;
  ModuleName: string | null;
  Certification: string | null;
  SubModuleName: string | null;
  MileStoneNo: string | null;
}

/** 2026-11-18: the ZED ID and the pledge date (yyyy-MM-dd, as the pledge certificate prints it; null when not known). */
export interface DocumentsUnit {
  ZedId: string;
  PledgeOn: string | null;
}

/** 2026-11-18: a certified level's date of certification and the date its certificate is valid till (yyyy-MM-dd). */
export interface CertifiedLevel {
  Level: string;
  CertifiedOn: string;
  ValidTill: string;
}

export interface MyDocuments {
  Guidelines: Guideline[];
  Certificates: CertificateLinks[];
  Invoices: Invoice[];
  /** 2026-11-18 (the user's applicant designs): the dates under the cards; absent from older answers. */
  Unit?: DocumentsUnit[];
  Certified?: CertifiedLevel[];
}

/** Client for api/msme/documents (Zed.Main.Api MsmeDocumentsController). */
@Injectable({ providedIn: 'root' })
export class DocumentsApi {
  private readonly http = inject(HttpClient);

  get(): Observable<MyDocuments> {
    return this.http.get<MyDocuments>('/api/msme/documents');
  }
}
