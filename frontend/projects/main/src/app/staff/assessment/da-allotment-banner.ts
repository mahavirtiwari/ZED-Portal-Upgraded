import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { text } from './assessment-shared';
import { AgencyAllotment, AssessmentApi, Person, Row } from './assessment.api';
import { AllotAssessorDialog, AllotChoice, agencyRejectAsk, assessorsForUnit } from './da-allot-actions';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { TextPipe, t } from '../../content/page-text';
import { Assessor, Row as SiteRow, SiteAssessmentApi } from '../site-assessment/site-assessment.api';
import { SaAllotDialog, SiteAllotChoice, siteRejectAsk } from '../site-assessment/sa-allot-actions';

/** The agency's allotment lists, where Accept / Reject return. */
export const DA_ALLOTMENT_URL = '/staff/assessment/da-allotment';
export const SA_ALLOTMENT_URL = '/staff/sa-allotment';

/**
 * 2026-11-18 (the user: "show assessment detail during the allocation in the login of assessment agency"): the banner of
 * the assessment details page when the agency opens a unit allotted to it and not yet accepted (the server sends
 * `allotment` then): when it was allotted, the assessor's answer, the applicant's contact in full, and the list's Accept /
 * Re-allot and Reject (the same pop-ups and APIs, da-allot-actions.ts). Done: back to the list with a toast.
 * 2026-11-18 (the user: "accept, reject, view details ... similar to combination one"): also for a unit waiting in the
 * agency's site-assessment allotment (`kind` 'site'): the site list's Accept (allot / re-allot to a site assessor) and
 * Reject (sa-allot-actions.ts, SiteAssessmentApi), back to "Allot SA Assessments".
 */
@Component({
  selector: 'zed-da-allotment-banner',
  imports: [AllotAssessorDialog, ConfirmDialog, SaAllotDialog, TextPipe],
  template: `
    @let a = allotment();
    <section class="ab" aria-labelledby="abTitle" data-allotment-banner>
      <span class="ab-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg></span>
      <div class="ab-body">
        <h4 id="abTitle">{{ heading() }}</h4>
        <p class="ab-line">{{ stageLine() }}</p>
        <dl class="ab-contact" [attr.aria-label]="'Applicant contact' | t: 'staff.daAllotment.banner.contactAria'">
          <div><dt>{{ 'Unit SPOC' | t: 'staff.daAllotment.banner.spocLabel' }}</dt><dd>{{ a.spocName || '—' }}</dd></div>
          <div><dt>{{ 'Mobile' | t: 'staff.daAllotment.banner.mobileLabel' }}</dt><dd>{{ a.mobile || '—' }}</dd></div>
          <div><dt>{{ 'E-mail' | t: 'staff.daAllotment.banner.emailLabel' }}</dt><dd>{{ a.email || '—' }}</dd></div>
          <div><dt>{{ 'PAN' | t: 'staff.daAllotment.banner.panLabel' }}</dt><dd>{{ a.pan || '—' }}</dd></div>
        </dl>
      </div>
      <div class="ab-actions">
        @if (a.canAllot) {
          <button type="button" class="btn btn-primary ab-allot" [disabled]="busy()" (click)="openAllot()">{{ a.assessorId ? ('Re-allot' | t: 'staff.daAllotment.banner.reallotButton') : ('Accept' | t: 'staff.daAllotment.banner.acceptButton') }}</button>
        }
        @if (a.canReject) {
          <button type="button" class="btn btn-outline-danger ab-reject" [disabled]="busy()" (click)="openReject()">{{ 'Reject' | t: 'staff.daAllotment.banner.rejectButton' }}</button>
        }
      </div>
    </section>

    @if (siteUnit(); as u) {
      <zed-sa-allot-dialog [unit]="u" [assessors]="siteAssessors()" [busy]="busy()" [failed]="failed()" (allot)="allotSite($event)" (cancel)="siteUnit.set(null)" />
    }
    @if (allotUnit(); as u) {
      <zed-allot-assessor-dialog [unit]="u" [assessors]="assessors()" [busy]="busy()" [failed]="failed()" (allot)="allot($event)" (cancel)="allotUnit.set(null)" />
    }
    @if (rejecting()) {
      <zed-confirm-dialog [ask]="rejectAsk()" [busy]="busy()" [failed]="failed()" inputId="daRejectReason" (confirmed)="reject($event)" (cancel)="rejecting.set(false)" />
    }
  `,
  styles: `
    :host { display: block; }
    .ab { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 14px; margin: 0 0 14px; padding: 14px 16px; border: 1px solid #f3d38b;
          border-left: 4px solid #e0a800; border-radius: 12px; background: #fff8e6; }
    .ab-ico { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: #ffeec2; }
    .ab-ico svg { width: 20px; height: 20px; fill: none; stroke: #8a5a00; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .ab-body { flex: 1 1 320px; min-width: 0; }
    .ab-body h4 { margin: 0; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .ab-line { margin: 2px 0 8px; font-size: 13px; color: #5f6f70; }
    .ab-contact { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 0; }
    .ab-contact dt { font-size: 11.5px; font-weight: 600; color: #6b7b7c; }
    .ab-contact dd { margin: 0; font-size: 13.5px; font-weight: 600; color: var(--zt-ink, #173f44); overflow-wrap: anywhere; }
    .ab-actions { display: flex; flex-wrap: wrap; gap: 8px; align-self: center; }
    .ab-actions .btn { min-width: 96px; font-weight: 600; }
  `,
})
export class DaAllotmentBanner {
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();
  readonly unitName = input('');
  readonly allotment = input.required<AgencyAllotment>();

  private readonly api = inject(AssessmentApi);
  private readonly siteApi = inject(SiteAssessmentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly busy = signal(false);
  protected readonly failed = signal('');
  /** The unit as in the agency's list (its kind and current assessor), while the Accept / Re-allot pop-up is open. */
  protected readonly allotUnit = signal<Row | null>(null);
  protected readonly assessors = signal<Person[]>([]);
  protected readonly rejecting = signal(false);
  /** Site: the unit as in the agency's SA list and its site assessors, while the Accept / Re-allot pop-up is open. */
  protected readonly siteUnit = signal<SiteRow | null>(null);
  protected readonly siteAssessors = signal<Assessor[]>([]);
  private readonly site = computed(() => this.allotment().kind === 'site');
  private readonly listUrl = computed(() => (this.site() ? SA_ALLOTMENT_URL : DA_ALLOTMENT_URL));

  private readonly unit = computed<Row>(() => ({ ZedId: this.zedId(), Certification: this.certification(), PUnitName: this.unitName() }));
  protected readonly rejectAsk = computed<ConfirmAsk>(() => (this.site() ? siteRejectAsk(this.unit() as SiteRow) : agencyRejectAsk(this.unit())));

  /** The title: when it was allotted and what waits. */
  protected readonly heading = computed(() => {
    const a = this.allotment();
    const started = a.kind === 'site' && a.stage === 'allotted';
    if (a.allottedOn) {
      const v = { date: a.allottedOn };
      return started ? t('staff.daAllotment.banner.notStartedOnTitle', 'Allotted to your agency on {date} · not yet started', v)
        : t('staff.daAllotment.banner.notAcceptedOnTitle', 'Allotted to your agency on {date} · not yet accepted', v);
    }
    return started ? t('staff.daAllotment.banner.notStartedTitle', 'Allotted to your agency · not yet started')
      : t('staff.daAllotment.banner.notAcceptedTitle', 'Allotted to your agency · not yet accepted');
  });

  /** What the agency can do now, under the title. */
  protected readonly stageLine = computed(() => {
    const a = this.allotment();
    const who = a.assessorName || a.assessorId || t('staff.daAllotment.banner.theAssessorLabel', 'The assessor');
    if (a.kind === 'site') {
      if (a.stage === 'allotted') return t('staff.daAllotment.banner.siteAllotted.text', 'Allotted to {name} for the site assessment, not started yet. You can still re-allot it.', { name: who });
      return a.preview
        ? t('staff.daAllotment.banner.sitePreview.text', 'A read-only preview of what the applicant submitted in the ZED MSME app. Accept it to allot the assessment to your site assessors, or reject it.')
        : t('staff.daAllotment.banner.siteDesktop.text', 'The desktop assessment is below. Accept it to allot the site assessment to your assessors, or reject it.');
    }
    if (a.stage === 'rejected') {
      return a.assessorReason
        ? t('staff.daAllotment.banner.rejectedReason.text', '{name} rejected it: {reason}. Re-allot it to another assessor or reject it.', { name: who, reason: a.assessorReason })
        : t('staff.daAllotment.banner.rejected.text', '{name} rejected it. Re-allot it to another assessor or reject it.', { name: who });
    }
    if (a.stage === 'allotted') return t('staff.daAllotment.banner.allotted.text', 'Allotted to {name}, who has not accepted it yet. You can still re-allot it.', { name: who });
    return t('staff.daAllotment.banner.preview.text', 'A read-only preview of what the applicant submitted in the ZED MSME app. Accept it to allot it to one of your desktop assessors, or reject it.');
  });

  /** Accept / Re-allot: the agency's assessors from the list's API (the unit's row tells its kind and current assessor). */
  protected async openAllot(): Promise<void> {
    if (this.site()) return this.openSiteAllot();
    this.busy.set(true);
    this.failed.set('');
    try {
      const res = await firstValueFrom(this.api.daAllotment());
      const row = res.rows.find((r) => text(r, 'ZedId') === this.zedId() && text(r, 'Certification') === this.certification());
      if (!row) {
        this.toast.error(t('staff.daAllotment.banner.toast.gone', 'This assessment can no longer be allotted.'), null);
        return;
      }
      this.assessors.set(assessorsForUnit(row, res.assessors, res.bronzeAssessors));
      this.allotUnit.set(row);
    } catch (err) {
      this.toast.error(apiErrorMessage(err), null);
    } finally {
      this.busy.set(false);
    }
  }

  /** Site Accept / Re-allot: the unit and the agency's site assessors from the site list's API. */
  private async openSiteAllot(): Promise<void> {
    this.busy.set(true);
    this.failed.set('');
    try {
      const res = await firstValueFrom(this.siteApi.allotments());
      const row = (res.units ?? []).find((r) => text(r, 'ZedId') === this.zedId() && text(r, 'Certification') === this.certification());
      if (!row) {
        this.toast.error(t('staff.daAllotment.banner.toast.gone', 'This assessment can no longer be allotted.'), null);
        return;
      }
      this.siteAssessors.set(res.assessors ?? []);
      this.siteUnit.set(row);
    } catch (err) {
      this.toast.error(apiErrorMessage(err), null);
    } finally {
      this.busy.set(false);
    }
  }

  protected async allotSite(choice: SiteAllotChoice): Promise<void> {
    await this.run(() => this.siteApi.allot(choice.request), t('staff.daAllotment.banner.toast.allotted', '{zedId} allotted', { zedId: this.zedId() }),
      choice.assessorName ? t('staff.daAllotment.banner.toast.allottedTo', 'To {name}.', { name: choice.assessorName }) : null);
  }

  protected openReject(): void {
    this.failed.set('');
    this.rejecting.set(true);
  }

  protected async allot(choice: AllotChoice): Promise<void> {
    await this.run(() => this.api.allotToAssessor(this.zedId(), this.certification(), choice.assessorId),
      t('staff.daAllotment.banner.toast.allotted', '{zedId} allotted', { zedId: this.zedId() }),
      t('staff.daAllotment.banner.toast.allottedTo', 'To {name}.', { name: choice.assessorName }));
  }

  protected async reject(reason: string): Promise<void> {
    if (!reason) return;
    const call = () => (this.site() ? this.siteApi.reject(this.zedId(), this.certification(), reason) : this.api.agencyReject(this.zedId(), this.certification(), reason));
    await this.run(call, t('staff.daAllotment.banner.toast.rejected', '{zedId} rejected', { zedId: this.zedId() }), null);
  }

  private async run(call: () => ReturnType<AssessmentApi['agencyReject']>, done: string, detail: string | null): Promise<void> {
    this.busy.set(true);
    this.failed.set('');
    try {
      await firstValueFrom(call());
      this.allotUnit.set(null);
      this.siteUnit.set(null);
      this.rejecting.set(false);
      this.toast.success(done, detail);
      await this.router.navigateByUrl(this.listUrl());
    } catch (err) {
      this.failed.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
