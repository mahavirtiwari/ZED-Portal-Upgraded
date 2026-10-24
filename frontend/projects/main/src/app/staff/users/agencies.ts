import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { AgencyRow, RESET_CONFIRM, UsersApi } from './users.api';
import { PORTAL_LABELS } from '../../portal-labels';
import { PagedView, PagerComponent } from '../pager';

type Mode = 'all' | 'bronze';

interface Dialog {
  kind: 'block' | 'disable-bronze' | 'mobile';
  agency: AgencyRow;
  text: string;
}

/**
 * MasterAdmin list of assessment agencies. Port of Views/User/AssessmentAgencies.cshtml (block /
 * unblock, edit) and BronzeAssessmentAgencies.cshtml (enable / disable Bronze assessments); the
 * route's `data.mode` ('all' | 'bronze') picks the page. Actions are POSTs (the old page used GET links).
 */
@Component({
  selector: 'zed-staff-agencies',
  imports: [FormsModule, RouterLink, PagerComponent],
  templateUrl: './agencies.html',
  styles: `
    .sub-heading { font-weight: 600; margin-bottom: 0; }
    td p { margin-bottom: 0; }
    .help-block { color: #a94442; font-size: 13px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class AgenciesPage {
  private readonly api = inject(UsersApi);

  protected readonly mode: Mode = inject(ActivatedRoute).snapshot.data['mode'] === 'bronze' ? 'bronze' : 'all';
  protected readonly title = this.mode === 'bronze' ? 'Bronze Assessment Agencies' : PORTAL_LABELS.agencies;
  protected readonly labels = PORTAL_LABELS;

  protected readonly agencies = signal<AgencyRow[]>([]);
  protected readonly search = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');
  protected readonly saving = signal(false);

  protected readonly filtered = computed(() => {
    const s = this.search().trim().toLowerCase();
    if (!s) return this.agencies();
    return this.agencies().filter((a) =>
      [a.UserId, a.UserName, a.SpocName, a.MobileNo, a.Email, a.Address, a.IdStatus].some((v) => (v ?? '').toLowerCase().includes(s)),
    );
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.filtered());

  constructor() {
    // Message of the form page after creating an agency.
    const message = (globalThis.history?.state as { message?: unknown } | null)?.message;
    if (typeof message === 'string') this.success.set(message);
    void this.load();
  }

  protected active(a: AgencyRow): boolean {
    return this.mode === 'bronze' ? a.AllowBronzeAssessments : a.IsActive;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.agencies.set(await firstValueFrom(this.api.agencies()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected open(kind: Dialog['kind'], agency: AgencyRow): void {
    this.success.set('');
    this.dialogError.set('');
    this.dialog.set({ kind, agency, text: kind === 'mobile' ? (agency.MobileNo ?? '') : '' });
  }

  protected close(): void {
    this.dialog.set(null);
  }

  protected async submitDialog(): Promise<void> {
    const d = this.dialog();
    if (!d) return;
    const text = d.text.trim();
    if (d.kind === 'mobile' ? !/^\d{10}$/.test(text) : !text) {
      this.dialogError.set(d.kind === 'mobile' ? 'Please enter a valid 10 digit mobile number.' : 'This is required.');
      return;
    }
    const id = d.agency.UserId;
    const call =
      d.kind === 'block'
        ? this.api.block('agencies', id, text)
        : d.kind === 'disable-bronze'
          ? this.api.bronzeAssessments(id, false, text)
          : this.api.resetMobile('agencies', id, text);
    if (await this.run(call, true)) this.dialog.set(null);
  }

  protected async unblock(a: AgencyRow): Promise<void> {
    if (!window.confirm('Are you sure that you want to unblock?')) return;
    await this.run(this.api.unblock('agencies', a.UserId), false);
  }

  /** E-mails the agency a link to set a new password. */
  protected async sendReset(a: AgencyRow): Promise<void> {
    if (!window.confirm(RESET_CONFIRM)) return;
    await this.run(this.api.passwordReset('agencies', a.UserId), false);
  }

  protected async enableBronze(a: AgencyRow): Promise<void> {
    if (!window.confirm('Are you sure that you want to Enable Bronze Assessments?')) return;
    await this.run(this.api.bronzeAssessments(a.UserId, true, ''), false);
  }

  private async run(call: Observable<MessageResponse>, inDialog: boolean): Promise<boolean> {
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(call);
      this.success.set(r.message);
      await this.load();
      return true;
    } catch (err) {
      (inDialog ? this.dialogError : this.error).set(apiErrorMessage(err));
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
