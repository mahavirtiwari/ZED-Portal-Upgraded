import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { withApiBase } from '../../api-base';

export type Row = Record<string, unknown>;

export interface RemotePhoto {
  id: number;
  name: string | null;
  url: string | null;
  deletable: boolean;
}

export interface Meeting {
  id: number;
  comments: string | null;
  participants: Row[];
  photos: RemotePhoto[];
}

export interface Selfie {
  url: string | null;
  representativeName: string | null;
  designation: string | null;
}

export interface RemoteDetails {
  zedId: string;
  certification: string;
  msme: Row;
  products: Row[];
  rawMaterials: Row[];
  sections: Row[];
  requirements: Row[];
  options: Row[];
  subOptions: Row[];
  evidences: Row[];
  daPhotos: Row[];
  location: Row | null;
  siteExteriorPhotos: RemotePhoto[];
  siteTourPhotos: RemotePhoto[];
  openMeeting: Meeting | null;
  closeMeeting: Meeting | null;
  selfies: Selfie[];
  permissions: { isLeadAssessor: boolean; canAssess: boolean; videoConfigured: boolean };
  /** Surveillance only: the assessment is held on the agency's meeting link (no video on this page). */
  usesMeetingLink?: boolean;
  /** Surveillance only: http/https address checked by the API. */
  meetingLink?: string | null;
  /** Surveillance only: recording links of the closing meeting (at most 6). */
  recordingLinks?: { id: number; url: string }[];
}

/** Surveillance: the old page allowed up to 6 recording links. */
export const MAX_RECORDING_LINKS = 6;

export interface JoinResponse {
  token: string;
  room: string;
  identity: string;
  expiresInSeconds: number;
}

export interface FinalSubmitCheck {
  allowed: boolean;
  message: string | null;
  raisesNc: boolean;
}

/** 'Selfie' is surveillance only (the assessor's "Selfie on Site" upload). */
export type PhotoTarget = 'SiteExterior' | 'SiteTour' | 'OpenMeeting' | 'CloseMeeting' | 'ProductPhoto' | 'ProductDescriptionPhoto' | 'Requirement' | 'Selfie';

export interface PhotoRequest {
  target: PhotoTarget;
  targetId?: number | null;
  name?: string | null;
  image?: string | null;
  fromPhotoId?: number | null;
}

/** Client for api/staff/remote/{zedId}/{certification} (Zed.Main.Api RemoteAssessmentController). */
@Injectable({ providedIn: 'root' })
export class RemoteApi {
  private readonly http = inject(HttpClient);

  private base(zedId: string, certification: string): string {
    return withApiBase(`/api/staff/remote/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`);
  }

  details(zedId: string, certification: string): Observable<RemoteDetails> {
    return this.http.get<RemoteDetails>(this.base(zedId, certification));
  }

  join(zedId: string, certification: string): Observable<JoinResponse> {
    return this.http.post<JoinResponse>(`${this.base(zedId, certification)}/join`, {});
  }

  basicInfo(zedId: string, certification: string, column: string, value: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/basic-info`, { column, value });
  }

  conformance(zedId: string, certification: string, id: number, conformance: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/requirements/${id}/conformance`, { conformance, remarks });
  }

  validateProduct(zedId: string, certification: string, id: number, isVerified: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/products/${id}/validate`, { isVerified, remarks });
  }

  validateSiteExterior(zedId: string, certification: string, isVerified: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/site-exterior/validate`, { isVerified, remarks });
  }

  ofiComments(zedId: string, certification: string, sectionId: number, comments: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/sections/${sectionId}/ofi`, { comments });
  }

  meetingComments(zedId: string, certification: string, meetingId: number, comments: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/meetings/${meetingId}/comments`, { comments });
  }

  addParticipant(zedId: string, certification: string, meetingId: number, name: string, designation: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/meetings/${meetingId}/participants`, { name, designation });
  }

  savePhoto(zedId: string, certification: string, req: PhotoRequest): Observable<{ photos: RemotePhoto[] }> {
    return this.http.post<{ photos: RemotePhoto[] }>(`${this.base(zedId, certification)}/photos`, req);
  }

  deletePhoto(zedId: string, certification: string, id: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.base(zedId, certification)}/photos/${id}`);
  }

  /** Surveillance: adds a recording link to the closing meeting. */
  addRecordingLink(zedId: string, certification: string, meetingId: number, link: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/meetings/${meetingId}/recording-links`, { link });
  }

  checkFinalSubmit(zedId: string, certification: string): Observable<FinalSubmitCheck> {
    return this.http.post<FinalSubmitCheck>(`${this.base(zedId, certification)}/final-submit/check`, {});
  }

  finalSubmit(zedId: string, certification: string, comments: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/final-submit`, { comments });
  }
}
