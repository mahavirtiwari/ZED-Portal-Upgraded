import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

export interface CodeName {
  id: number;
  code: string;
  name: string;
}

export type CodeNameKind = 'sectors' | 'categories';

export interface Technology {
  id: number;
  technologyCode: string;
  technologyName: string;
  description: string | null;
  sectors: string[];
  categories: string[];
  isActive: boolean;
}

export interface TechnologyOptions {
  sectors: string[];
  categories: string[];
}

export interface TechnologyRequest {
  technologyCode: string;
  technologyName: string;
  description: string;
  sectors: string[];
  categories: string[];
}

export interface DocumentRow {
  id: number;
  documentName: string;
  fileName: string | null;
  downloadUrl: string | null;
}

export interface PageSettings {
  hasBanner: boolean;
  fileName: string | null;
  updatedOn: string | null;
  imageUrl: string | null;
}

export interface Parameter {
  id: number;
  sectionType: string;
  sectionCode: string;
  sectionName: string;
  description: string | null;
}

/** Client for api/staff/masters (Zed.Main.Api StaffMastersController / StaffDocumentsController). Admin only. */
@Injectable({ providedIn: 'root' })
export class MastersApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/staff/masters';

  list(kind: CodeNameKind): Observable<CodeName[]> {
    return this.http.get<CodeName[]>(`${this.base}/${kind}`);
  }

  add(kind: CodeNameKind, code: string, name: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}`, { code, name });
  }

  rename(kind: CodeNameKind, id: number, name: string): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/${kind}/${id}`, { name });
  }

  technologies(): Observable<Technology[]> {
    return this.http.get<Technology[]>(`${this.base}/technologies`);
  }

  technologyOptions(): Observable<TechnologyOptions> {
    return this.http.get<TechnologyOptions>(`${this.base}/technologies/options`);
  }

  addTechnology(req: TechnologyRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/technologies`, req);
  }

  updateTechnology(id: number, req: TechnologyRequest): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/technologies/${id}`, req);
  }

  setTechnologyActive(id: number, isActive: boolean): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/technologies/${id}/active`, { isActive });
  }

  documents(): Observable<DocumentRow[]> {
    return this.http.get<DocumentRow[]>(`${this.base}/documents`);
  }

  addDocument(documentName: string, file: File): Observable<MessageResponse> {
    const form = new FormData();
    form.append('documentName', documentName);
    form.append('file', file, file.name);
    return this.http.post<MessageResponse>(`${this.base}/documents`, form);
  }

  deleteDocument(id: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.base}/documents/${id}`);
  }

  pageSettings(): Observable<PageSettings> {
    return this.http.get<PageSettings>(`${this.base}/page-settings`);
  }

  saveBanner(file: File): Observable<MessageResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<MessageResponse>(`${this.base}/page-settings/banner`, form);
  }

  parameters(sectionType: string): Observable<Parameter[]> {
    return this.http.get<Parameter[]>(`${this.base}/parameters/${encodeURIComponent(sectionType)}`);
  }

  addParameter(sectionType: string, sectionCode: string, sectionName: string, description: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/parameters/${encodeURIComponent(sectionType)}`, { sectionCode, sectionName, description });
  }

  updateParameter(sectionType: string, id: number, sectionName: string, description: string): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/parameters/${encodeURIComponent(sectionType)}/${id}`, { sectionName, description });
  }
}
