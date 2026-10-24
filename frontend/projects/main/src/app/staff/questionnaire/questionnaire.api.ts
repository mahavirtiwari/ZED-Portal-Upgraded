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
}

export interface Evidence {
  evidenceCode?: string;
  evidenceName: string;
  helpText: string | null;
  validationRequired: boolean;
}

export interface Requirement {
  id: number;
  requirementCode: string;
  points: Point[];
  mandatoryEvidences: Evidence[];
  optionalEvidences: Evidence[];
  canRemove: boolean;
}

export interface RequirementsResponse {
  sectionType: string;
  sectionCode: string;
  sectionName: string;
  requirements: Requirement[];
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

  removePoint(sectionType: string, sectionCode: string, id: number, pointId: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.base(sectionType, sectionCode)}/${id}/points/${pointId}`);
  }
}
