import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { withApiBase } from '../../api-base';

/** Agency / master-admin actions open to the signed-in user on a review page (server: ReviewRules). */
export interface ReviewActions {
  editRemarks: boolean;
  finalSubmit: boolean;
  sendBack: boolean;
  reject: boolean;
  any?: boolean;
}

export const NO_REVIEW: ReviewActions = { editRemarks: false, finalSubmit: false, sendBack: false, reject: false, any: false };

/**
 * Items whose remarks the agency edits. Desktop page: product, requirement, photo (site exterior).
 * Site page: product, requirement, photo (NC site exterior), meeting, summary (assessor final remarks),
 * nc-comments (assessor comments of an NC round).
 */
export type RemarksKind = 'product' | 'requirement' | 'photo' | 'meeting' | 'summary' | 'nc-comments';

/** Client for api/staff/monitoring/review (Zed.Main.Api MonitoringReviewController). */
@Injectable({ providedIn: 'root' })
export class ReviewApi {
  private readonly http = inject(HttpClient);

  private base(zedId: string, certification: string): string {
    return withApiBase(`/api/staff/monitoring/review/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`);
  }

  remarks(zedId: string, certification: string, kind: RemarksKind, id: unknown, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/remarks`, { kind, id: Number(id) || 0, remarks });
  }

  ofiComments(zedId: string, certification: string, sectionId: unknown, comments: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/ofi-comments`, { sectionId: Number(sectionId), comments });
  }

  finalSubmit(zedId: string, certification: string, exemptionsReviewed: boolean, qualityChecked: boolean): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/final-submit`, { exemptionsReviewed, qualityChecked });
  }

  sendBack(zedId: string, certification: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/send-back`, { remarks });
  }

  reject(zedId: string, certification: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base(zedId, certification)}/reject`, { confirmed: true });
  }
}
