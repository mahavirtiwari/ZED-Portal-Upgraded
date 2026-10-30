import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { ADMIN_PORTAL, AdminPortal } from '../admin-portal';

export interface CodeName {
  id: number;
  code: string;
  name: string;
  /** Sectors only (V4): Manufacturing or Services; null when not set yet. */
  activity?: SectorActivity | null;
}

export type SectorActivity = 'Manufacturing' | 'Services';
export const SECTOR_ACTIVITIES: SectorActivity[] = ['Manufacturing', 'Services'];

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
  /** V4 (Documents/Videos): description, a video's address (no file then) and the role keys that may open it. */
  description: string | null;
  videoUrl: string | null;
  roles: string[];
  createdDate: string | null;
}

export interface DocumentRole {
  key: string;
  label: string;
}

export interface DocumentsResponse {
  documents: DocumentRow[];
  roles: DocumentRole[];
}

/** A new document: a file or a video link, given to the roles ticked. */
export interface NewDocument {
  documentName: string;
  description: string;
  roles: string[];
  file: File | null;
  videoUrl: string | null;
}

export interface DocumentUpdate {
  documentName: string;
  description: string;
  videoUrl: string | null;
  roles: string[];
}

export interface PageSettings {
  hasBanner: boolean;
  fileName: string | null;
  updatedOn: string | null;
  imageUrl: string | null;
}

export interface ParameterLevel {
  code: string;
  name: string;
  isEnabled: boolean;
}

export interface Parameter {
  id: number;
  sectionType: string;
  sectionCode: string;
  sectionName: string;
  description: string | null;
  /** Assessed again in surveillance (legacy Sections.SurveMandatories): the surveillance copies only these. */
  inSurveillance?: boolean;
  /** NIC 2-digit sectors it applies to (V4); empty = all sectors. */
  nicSectors?: string[] | null;
}

/** The request context that sends a call to the given portal's API (none: the switch decides). */
function on(portal?: AdminPortal): HttpContext {
  const context = new HttpContext();
  return portal ? context.set(ADMIN_PORTAL, portal) : context;
}

/** Client for api/staff/masters (Zed.Main.Api StaffMastersController / StaffDocumentsController). Admin only. */
@Injectable({ providedIn: 'root' })
export class MastersApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/staff/masters';

  /** <paramref name="portal"/>: the main Admin reading or changing another portal's list (V4 one Admin). */
  list(kind: CodeNameKind, portal?: AdminPortal): Observable<CodeName[]> {
    return this.http.get<CodeName[]>(`${this.base}/${kind}`, { context: on(portal) });
  }

  /** activity: sectors only (Manufacturing or Services). */
  add(kind: CodeNameKind, code: string, name: string, activity?: SectorActivity | null, portal?: AdminPortal): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}`, kind === 'sectors' ? { code, name, activity } : { code, name }, { context: on(portal) });
  }

  rename(kind: CodeNameKind, id: number, name: string, activity?: SectorActivity | null, portal?: AdminPortal): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/${kind}/${id}`, kind === 'sectors' ? { name, activity } : { name }, { context: on(portal) });
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

  documents(): Observable<DocumentsResponse> {
    return this.http.get<DocumentsResponse>(`${this.base}/documents`);
  }

  addDocument(d: NewDocument): Observable<MessageResponse> {
    const form = new FormData();
    form.append('documentName', d.documentName);
    form.append('description', d.description);
    form.append('roles', d.roles.join(','));
    if (d.videoUrl) form.append('videoUrl', d.videoUrl);
    else if (d.file) form.append('file', d.file, d.file.name);
    return this.http.post<MessageResponse>(`${this.base}/documents`, form);
  }

  updateDocument(id: number, d: DocumentUpdate): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/documents/${id}`, d);
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

  /** The certification levels with a questionnaire (Administration → Certification Levels), disabled ones included. */
  parameterLevels(): Observable<ParameterLevel[]> {
    return this.http.get<ParameterLevel[]>(`${this.base}/parameter-levels`);
  }

  addParameter(sectionType: string, sectionCode: string, sectionName: string, description: string, nicSectors: string[] = [], inSurveillance?: boolean): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/parameters/${encodeURIComponent(sectionType)}`, { sectionCode, sectionName, description, nicSectors, inSurveillance });
  }

  updateParameter(sectionType: string, id: number, sectionName: string, description: string, nicSectors: string[] = [], inSurveillance?: boolean): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/parameters/${encodeURIComponent(sectionType)}/${id}`, { sectionName, description, nicSectors, inSurveillance });
  }
}
