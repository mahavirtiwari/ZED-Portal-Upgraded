import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

/** Rows keep the procedure's column names (ZedId, PUnitName, UdyogAadharNo, EnterpriseTypee, ...). */
export type ProfileRow = Record<string, string | number | null>;

export interface ProfileResponse {
  msme: ProfileRow;
  basicInfo: ProfileRow;
  /** The registered (pledge) e-mail: ZED mails and password links go there. */
  registeredEmail: string | null;
  /**
   * 2026-11-18: the mobile shown (the Udyam record's) is the one the unit registered with, which the Udyam service accepted
   * for its Udyam number; absent from older answers.
   */
  mobileVerified?: boolean;
}

/** An activity of the MSME's Udyam record, with the Ministry service's column names. */
export interface UdyamActivity {
  Activity: string;
  Two_DigitActivity: string;
  Four_DigitActivity: string;
  Five_DigitActivity: string;
}

/** What the profile's header reads of api/msme/dashboard (the pledge date, the enterprise size, the certification statuses). */
export interface ProfileDashboard {
  msme: ProfileRow;
  certStatus: ProfileRow;
  /** The V4 levels (ZED-X and the Admin's), after Bronze, Silver and Gold. */
  levels?: { code: string; name: string }[];
}

/** Client for api/msme/profile (Zed.Main.Api MsmeProfileController). The ZED ID comes from the sign-in cookie. */
@Injectable({ providedIn: 'root' })
export class ProfileApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/msme/profile';

  get(): Observable<ProfileResponse> {
    return this.http.get<ProfileResponse>(this.base);
  }

  activities(): Observable<UdyamActivity[]> {
    return this.http.get<UdyamActivity[]>(`${this.base}/activities`);
  }

  updateActivity(fiveDigitActivity: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/activity`, { fiveDigitActivity });
  }

  /** The dashboard's data (existing API, read only) for the header's chips; the profile API has no certification. */
  dashboard(): Observable<ProfileDashboard> {
    return this.http.get<ProfileDashboard>('/api/msme/dashboard');
  }

  /** The number of recorded changes (api/msme/edit-history's total) for the section menu. */
  editHistoryTotal(): Observable<{ total: number }> {
    return this.http.get<{ total: number }>('/api/msme/edit-history', { params: { pageNo: 1, pageSize: 10 } });
  }

  /** Change of the registered e-mail, step 1: an OTP to the new address. */
  sendEmailOtp(email: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/email/otp`, { email });
  }

  /** Step 2: the OTP makes it the registered e-mail. */
  verifyEmailOtp(otp: string): Observable<{ message: string; email: string }> {
    return this.http.post<{ message: string; email: string }>(`${this.base}/email/verify`, { otp });
  }
}
