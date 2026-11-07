import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

export interface Bullet {
  id: number;
  subOptionCode: string;
  name: string;
}

export interface Point {
  id: number;
  optionCode: string;
  name: string;
  bullets: Bullet[];
  /** Options.OptionImage: a path under the site root shown below the point (null when there is none). */
  optionImage?: string | null;
  /** V4: a point is a Yes / No checkpoint; these are the actions needed when the answer is No or Partial. */
  actions?: string[] | null;
}

export interface Evidence {
  evidenceCode?: string;
  evidenceName: string;
  helpText: string | null;
  validationRequired: boolean;
  /** V4: the checkpoint (Point.optionCode) it belongs to; null = the whole requirement (added before checkpoints). */
  optionCode?: string | null;
  /** V4: the sample copy's file name, null = none. */
  sampleFile?: string | null;
}

export interface Requirement {
  id: number;
  requirementCode: string;
  points: Point[];
  mandatoryEvidences: Evidence[];
  optionalEvidences: Evidence[];
  canRemove: boolean;
  purpose?: string | null;
  benefits?: string | null;
  /** The video tutorial's link (migration 0056), null = none. */
  videoUrl?: string | null;
}

export interface RequirementsResponse {
  sectionType: string;
  sectionCode: string;
  sectionName: string;
  requirements: Requirement[];
  /** False until database migration 0034 is applied (purpose, benefits and checkpoints cannot be saved). */
  checklistReady?: boolean;
}

export interface ChecklistEvidence {
  evidenceName: string;
  mandatory: boolean;
  sampleFile: string | null;
  helpText: string | null;
  validationRequired: boolean;
}

export interface ChecklistPoint {
  /** The checkpoint being edited; null = new. */
  optionCode: string | null;
  text: string;
  evidences: ChecklistEvidence[];
  actions: string[];
}

export interface ChecklistRequest {
  purpose: string;
  benefits: string;
  /** The video tutorial's link; empty = none. */
  videoUrl: string;
  checkpoints: ChecklistPoint[];
  /** Evidences of the whole requirement (added before checkpoints): kept or removed. */
  generalEvidences: ChecklistEvidence[];
}

export interface NewPoint {
  name: string;
  bullets: string[];
}

/** Client for api/staff/questionnaire (Zed.Main.Api QuestionnaireController). Admin only. */
@Injectable({ providedIn: 'root' })
export class QuestionnaireApi {
  private readonly http = inject(HttpClient);

  private base(sectionType: string, sectionCode: string): string {
    return `/api/staff/questionnaire/${encodeURIComponent(sectionType)}/${encodeURIComponent(sectionCode)}/requirements`;
  }

  requirements(sectionType: string, sectionCode: string): Observable<RequirementsResponse> {
    return this.http.get<RequirementsResponse>(this.base(sectionType, sectionCode));
  }

  addRequirement(sectionType: string, sectionCode: string, points: NewPoint[]): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(this.base(sectionType, sectionCode), { points });
  }

  saveEvidences(sectionType: string, sectionCode: string, id: number, mandatoryEvidences: Evidence[], optionalEvidences: Evidence[]): Observable<MessageResponse> {
    const strip = (e: Evidence) => ({ evidenceName: e.evidenceName, helpText: e.helpText, validationRequired: e.validationRequired });
    return this.http.put<MessageResponse>(`${this.base(sectionType, sectionCode)}/${id}/evidences`, {
      mandatoryEvidences: mandatoryEvidences.map(strip),
      optionalEvidences: optionalEvidences.map(strip),
    });
  }

  removeRequirement(sectionType: string, sectionCode: string, id: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.base(sectionType, sectionCode)}/${id}`);
  }

  /** The requirements' API, also the base of their Excel (zed-excel-tools). */
  requirementsUrl(sectionType: string, sectionCode: string): string {
    return this.base(sectionType, sectionCode);
  }

  addChecklist(sectionType: string, sectionCode: string, body: ChecklistRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(sectionType, sectionCode)}/checklist`, body);
  }

  updateChecklist(sectionType: string, sectionCode: string, id: number, body: ChecklistRequest): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base(sectionType, sectionCode)}/${id}/checklist`, body);
  }

  /** Stores a sample copy; the requirement's Save links it to its evidence. */
  uploadSample(sectionType: string, sectionCode: string, file: File): Observable<{ fileName: string; message: string }> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<{ fileName: string; message: string }>(`${this.base(sectionType, sectionCode)}/samples`, form);
  }

  sampleUrl(sectionType: string, sectionCode: string, fileName: string): string {
    return `${this.base(sectionType, sectionCode)}/samples/${encodeURIComponent(fileName)}`;
  }

  removePoint(sectionType: string, sectionCode: string, id: number, pointId: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.base(sectionType, sectionCode)}/${id}/points/${pointId}`);
  }
}
