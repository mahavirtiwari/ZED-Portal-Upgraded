import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

/** Rows keep the procedure's column names (ZedId, PUnitName, UdyogAadharNo, EnterpriseTypee, ...). */
export type ProfileRow = Record<string, string | number | null>;

export interface ProfileResponse {
  msme: ProfileRow;
  basicInfo: ProfileRow;
}

/** An activity of the MSME's Udyam record, with the Ministry service's column names. */
export interface UdyamActivity {
  Activity: string;
  Two_DigitActivity: string;
  Four_DigitActivity: string;
  Five_DigitActivity: string;
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
}
