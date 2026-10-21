import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

/** Udyam rows keep the column names of the Ministry service (EnterpriseName, DISTRICT_NAME, Two_DigitActivity, ...). */
export type UdyamRow = Record<string, string>;

export interface LookupResponse {
  registrationId: string;
  basicDetails: UdyamRow;
  plants: UdyamRow[];
  activities: UdyamRow[];
}

export interface SubmitResponse {
  zedId: string;
  unitName: string;
  emailSent: boolean;
}

/** Client for api/msme/registration (Zed.Main.Api MsmeRegistrationController). */
@Injectable({ providedIn: 'root' })
export class RegistrationApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/msme/registration';

  lookup(registrationNo: string, mobileNo: string, captchaToken: string): Observable<LookupResponse> {
    return this.http.post<LookupResponse>(`${this.base}/lookup`, { registrationNo, mobileNo, captchaToken });
  }

  selectPlant(id: string, plantIndex: number, activityIndex: number): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${id}/plant`, { plantIndex, activityIndex });
  }

  sendOtp(id: string, email: string, confirmEmail: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${id}/email-otp`, { email, confirmEmail });
  }

  verifyOtp(id: string, otp: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${id}/email-otp/verify`, { otp });
  }

  submit(id: string): Observable<SubmitResponse> {
    return this.http.post<SubmitResponse>(`${this.base}/${id}/submit`, { acceptedDeclaration: true, tookPledge: true });
  }
}
