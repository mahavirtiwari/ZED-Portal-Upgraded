import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService, Recaptcha, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { LookupResponse, RegistrationApi, SubmitResponse, UdyamRow } from './registration.api';
import { PublicLayout } from '../public-layout/public-layout';

type Step = 'welcome' | 'udyam' | 'plant' | 'summary' | 'pledge' | 'success';

const STEP_NUMBER: Record<Step, number> = { welcome: 0, udyam: 1, plant: 2, summary: 3, pledge: 4, success: 4 };

/**
 * New MSME registration. Port of the Udyam path of Views/Msme/Register.cshtml
 * (DisplayStep -1, 1, 2, 3, 33 and 4 plus the pledge e-mail and OTP modals).
 * Every step is validated again by the API; this page only guides the user.
 */
@Component({
  selector: 'zed-msme-register',
  imports: [FormsModule, RouterLink, Recaptcha, PublicLayout],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class RegisterPage {
  private readonly api = inject(RegistrationApi);
  private readonly auth = inject(AuthService);
  private readonly captcha = viewChild(Recaptcha);

  protected readonly step = signal<Step>('welcome');
  protected readonly stepNumber = computed(() => STEP_NUMBER[this.step()]);
  protected readonly modal = signal<'email' | 'otp' | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly modalError = signal('');

  // Step 1
  protected registrationNo = '';
  protected mobileNo = '';
  private captchaToken = '';

  // Data from the Udyam service
  protected readonly lookup = signal<LookupResponse | null>(null);
  protected readonly basic = computed<UdyamRow>(() => this.lookup()?.basicDetails ?? {});

  // Step 2
  protected readonly plantIndex = signal<number | null>(null);
  protected readonly activityIndex = signal<number | null>(null);
  protected readonly selectedPlant = computed(() => this.pick(this.lookup()?.plants, this.plantIndex()));
  protected readonly selectedActivity = computed(() => this.pick(this.lookup()?.activities, this.activityIndex()));

  // E-mail and OTP
  protected email = '';
  protected confirmEmail = '';
  protected otp = '';
  protected readonly verifiedEmail = signal('');
  protected readonly resendIn = signal(0);
  private resendTimer: ReturnType<typeof setInterval> | null = null;

  // Summary / pledge
  protected accepted = false;
  protected readonly pledgeReady = signal(false);
  protected readonly result = signal<SubmitResponse | null>(null);

  protected readonly pledgeLines = [
    'We undertake to conform to the values of Zero Defect Zero Effect in our',
    'enterprise and ensure that our processes shall be environmentally sound and',
    'socially responsible with safe and high quality products. We will give back, in',
    'every way we can, to our people, our community and to our planet.',
  ];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopResendTimer());
  }

  protected go(step: Step): void {
    this.error.set('');
    this.step.set(step);
    window.scrollTo(0, 0);
  }

  protected onCaptcha(token: string): void {
    this.captchaToken = token;
  }

  protected normaliseRegNo(): void {
    this.registrationNo = this.registrationNo.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  }

  /** Step 1 → 2: validate with the Udyam portal. */
  protected async submitUdyam(): Promise<void> {
    this.normaliseRegNo();
    if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(this.registrationNo)) {
      this.error.set('Please enter a valid Udyam Registration Number.');
      return;
    }
    if (!/^\d{10}$/.test(this.mobileNo)) {
      this.error.set('Please enter a valid 10 digit mobile number.');
      return;
    }
    if (!this.captchaToken) {
      this.error.set('Invalid captcha.');
      return;
    }
    const res = await this.call(this.api.lookup(this.registrationNo, this.mobileNo, this.captchaToken), () => this.captcha()?.reset());
    if (!res) return;
    this.lookup.set(res);
    this.plantIndex.set(null);
    this.activityIndex.set(null);
    this.verifiedEmail.set('');
    this.go('plant');
  }

  /** Step 2: plant and activity chosen → ask for the pledge e-mail. */
  protected async submitPlant(): Promise<void> {
    const p = this.plantIndex();
    const a = this.activityIndex();
    if (p === null || a === null) {
      this.error.set('Please select the valid data.');
      return;
    }
    const ok = await this.call(this.api.selectPlant(this.lookup()!.registrationId, p, a));
    if (!ok) return;
    if (this.verifiedEmail()) {
      this.go('summary');
    } else {
      this.openEmailModal();
    }
  }

  protected openEmailModal(): void {
    this.modalError.set('');
    this.confirmEmail = '';
    this.modal.set('email');
  }

  /** E-mail modal → send OTP. */
  protected async sendOtp(): Promise<void> {
    this.modalError.set('');
    const email = this.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.modalError.set('Please enter the valid Email ID.');
      return;
    }
    if (email.toLowerCase() !== this.confirmEmail.trim().toLowerCase()) {
      this.modalError.set('Email ID not matching.');
      return;
    }
    const ok = await this.call(this.api.sendOtp(this.lookup()!.registrationId, email, this.confirmEmail.trim()), undefined, true);
    if (!ok) return;
    // A new OTP invalidates the previous verification on the server.
    this.verifiedEmail.set('');
    this.otp = '';
    this.modal.set('otp');
    this.startResendTimer();
  }

  protected async resendOtp(): Promise<void> {
    if (this.resendIn() > 0) return;
    this.modalError.set('');
    const ok = await this.call(this.api.sendOtp(this.lookup()!.registrationId, this.email.trim(), this.email.trim()), undefined, true);
    if (ok) this.startResendTimer();
  }

  /** OTP modal → summary. */
  protected async verifyOtp(): Promise<void> {
    this.modalError.set('');
    if (!/^\d{6}$/.test(this.otp.trim())) {
      this.modalError.set('Invalid OTP.');
      return;
    }
    const ok = await this.call(this.api.verifyOtp(this.lookup()!.registrationId, this.otp.trim()), undefined, true);
    if (!ok) return;
    this.verifiedEmail.set(this.email.trim());
    this.modal.set(null);
    this.stopResendTimer();
    this.go('summary');
  }

  /** Summary → pledge. The pledge button unlocks after the text has faded in (5 s, as before). */
  protected toPledge(): void {
    if (!this.verifiedEmail()) {
      this.openEmailModal();
      return;
    }
    if (!this.accepted) {
      this.error.set('Please enter the valid data.');
      return;
    }
    this.pledgeReady.set(false);
    this.go('pledge');
    setTimeout(() => this.pledgeReady.set(true), 5000);
  }

  /** "I/WE PLEDGE" → create the registration. */
  protected async takePledge(): Promise<void> {
    if (!this.pledgeReady()) return;
    const res = await this.call(this.api.submit(this.lookup()!.registrationId));
    if (!res) return;
    this.result.set(res);
    await this.auth.refresh().catch(() => undefined);
    this.go('success');
  }

  protected plantAddress(p: UdyamRow | null): string {
    if (!p) return '';
    const parts = p['PAddress']
      ? [p['PAddress'], p['DISTRICT_NAME'], p['state_name'], p['PPin']]
      : [p['PFlat'], p['PBuilding'], p['PRoad'], p['PArea'], p['PCity'], p['DISTRICT_NAME'], p['state_name'], p['PPin']];
    return parts.filter((x) => x && x.trim()).join(', ');
  }

  protected enterpriseInitial(type: string | undefined): string {
    return type === 'Small' ? 'S' : 'M';
  }

  private pick(rows: UdyamRow[] | undefined, i: number | null): UdyamRow | null {
    return rows && i !== null && i >= 0 && i < rows.length ? rows[i] : null;
  }

  /** Runs a request with the busy overlay; shows the API message on failure. 410 means the server session expired. */
  private async call<T>(req: Observable<T>, onError?: () => void, inModal = false): Promise<T | null> {
    this.busy.set(true);
    (inModal ? this.modalError : this.error).set('');
    try {
      return await firstValueFrom(req);
    } catch (err) {
      onError?.();
      if (err instanceof HttpErrorResponse && err.status === 410) {
        this.modal.set(null);
        this.lookup.set(null);
        this.go('udyam');
        this.error.set(apiErrorMessage(err));
      } else if (inModal) {
        this.modalError.set(apiErrorMessage(err));
      } else {
        // The message is shown above the step; bring it into view.
        this.error.set(apiErrorMessage(err));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  private startResendTimer(): void {
    this.stopResendTimer();
    this.resendIn.set(60);
    this.resendTimer = setInterval(() => {
      this.resendIn.update((s) => Math.max(0, s - 1));
      if (this.resendIn() === 0) this.stopResendTimer();
    }, 1000);
  }

  private stopResendTimer(): void {
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = null;
  }
}
