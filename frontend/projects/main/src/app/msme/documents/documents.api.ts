import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Rows of SP_MSME_GET_MY_DOCUMENTS with its column names. File columns hold `/api/msme/files/...`
 * links (or null when there is no file); Wash and Webinar link to the KAWACH portal.
 */
export interface Guideline {
  DocumentName: string;
  DocumentPath: string | null;
}

export interface CertificateLinks {
  Pledge: string | null;
  Bronze: string | null;
  Silver: string | null;
  Gold: string | null;
  Wash: string | null;
  Webinar: string | null;
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

export interface MyDocuments {
  Guidelines: Guideline[];
  Certificates: CertificateLinks[];
  Invoices: Invoice[];
}

/** Client for api/msme/documents (Zed.Main.Api MsmeDocumentsController). */
@Injectable({ providedIn: 'root' })
export class DocumentsApi {
  private readonly http = inject(HttpClient);

  get(): Observable<MyDocuments> {
    return this.http.get<MyDocuments>('/api/msme/documents');
  }
}
