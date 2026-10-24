import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { Row } from '../../assessment/assessment.api';
import { withApiBase } from '../../../api-base';

export type { Row };

export interface MilestonePhoto {
  id: number | null;
  name: string | null;
  /** Authorised address (null when the stored address was not a file of this unit). */
  url: string | null;
  createdDate: string | null;
  ncCount: number | null;
  /** The consultant who took it (handholding training photos). */
  assessorId: string | null;
}

export interface MilestoneMeeting {
  id: number | null;
  ncCount: number | null;
  comments: string | null;
  photos: MilestonePhoto[];
  /** Name, Designation. */
  participants: Row[];
  /** The user may change the remarks ("Edit Remarks"). */
  editable: boolean;
}

export type BulletType = 'BaselineDiagnostic' | 'HandholdingActionPlan' | 'TechnologyIntervention';

export interface MilestoneBullet {
  id: number;
  requirementId: string | null;
  reqType: BulletType | string | null;
  text: string | null;
  ncCount: number | null;
  editable: boolean;
}

export interface MilestonePermissions {
  canEdit: boolean;
  /** Requirement columns editable in this milestone (server allow-list). */
  editableFields: string[];
  canEditBullets: boolean;
  canConsultantFinalSubmit: boolean;
  canCoFinalSubmit: boolean;
  canSendBack: boolean;
  canReject: boolean;
}

/** Viewer, Lead, CoConsultant or Co (Consultant Organisation). */
export type MilestoneParty = 'Viewer' | 'Lead' | 'CoConsultant' | 'Co';

export interface MilestoneDetails {
  zedId: string;
  certification: string;
  milestone: number;
  status: number;
  party: MilestoneParty;
  role: string;
  /** One row per milestone (NcCount 1..3). */
  milestones: Row[];
  coConsultants: { userId: string; submitted: boolean; submittedOn: string | null }[];
  allotments: Row[];
  sections: Row[];
  /** With Editable and Photos. */
  requirements: Row[];
  options: Row[];
  subOptions: Row[];
  bullets: MilestoneBullet[];
  zedTrainings: Row[];
  zedTrainingPhotos: MilestonePhoto[];
  handholdingTrainings: Row[];
  handholdingTrainingPhotos: MilestonePhoto[];
  basicInformation: Row[];
  openMeetings: MilestoneMeeting[];
  closeMeetings: MilestoneMeeting[];
  siteExterior: MilestonePhoto[];
  siteTour: MilestonePhoto[];
  selfies: MilestonePhoto[];
  attendance: Row[];
  attendanceConsultants: Row[];
  /** The consultants' location per milestone (SaLatitude, SaLongitude). */
  locations: Row[];
  /** The unit's ZED certification location (ZedSaLatitude, ZedSaLongitude). */
  zedLocation: Row | null;
  permissions: MilestonePermissions;
}

export const MILESTONE_LEVELS = ['Silver', 'Gold'] as const;

export function milestoneLevel(value: string | null | undefined): string | null {
  const v = (value ?? '').toLowerCase();
  return MILESTONE_LEVELS.find((l) => l.toLowerCase() === v) ?? null;
}

/** Client for api/consultancy/milestones (Zed.Portal Features/Consultancy/Milestones, Consultancy host). */
@Injectable({ providedIn: 'root' })
export class MilestonesApi {
  private readonly http = inject(HttpClient);

  private base(zedId: string, level: string): string {
    return withApiBase(`/api/consultancy/milestones/${encodeURIComponent(zedId)}/${encodeURIComponent(level)}`);
  }

  details(zedId: string, level: string): Observable<MilestoneDetails> {
    return this.http.get<MilestoneDetails>(this.base(zedId, level));
  }

  updateRequirement(zedId: string, level: string, id: unknown, field: string, value: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, level)}/requirements/${Number(id)}`, { field, value });
  }

  addBullet(zedId: string, level: string, requirementId: unknown, reqType: string, text: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, level)}/bullets`, { requirementId: Number(requirementId), reqType, text });
  }

  editBullet(zedId: string, level: string, id: number, text: string): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base(zedId, level)}/bullets/${id}`, { text });
  }

  deleteBullet(zedId: string, level: string, id: number): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`${this.base(zedId, level)}/bullets/${id}`);
  }

  trainingRemarks(zedId: string, level: string, id: unknown, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, level)}/trainings/${Number(id)}/remarks`, { remarks });
  }

  meetingRemarks(zedId: string, level: string, id: number, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, level)}/meetings/${id}/remarks`, { remarks });
  }

  consultantCheck(zedId: string, level: string): Observable<{ allowed: boolean; message: string }> {
    return this.http.post<{ allowed: boolean; message: string }>(`${this.base(zedId, level)}/consultant/check`, {});
  }

  consultantFinalSubmit(zedId: string, level: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, level)}/consultant/final-submit`, { remarks });
  }

  finalSubmit(zedId: string, level: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, level)}/final-submit`, { confirmed: true });
  }

  sendBack(zedId: string, level: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, level)}/send-back`, { remarks });
  }

  reject(zedId: string, level: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, level)}/reject`, { confirmed: true });
  }
}
