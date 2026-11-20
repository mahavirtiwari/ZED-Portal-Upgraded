import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { CheckEdit, SchemeAnswers, SchemeSummary } from './scheme-parts';
import { SchemeDialogs, day, money, schemeAsks } from './scheme-shared';
import { CheckInput, SchemeDetail, SchemeField, SchemeVerificationApi } from './scheme-verification.api';

/**
 * 2026-11-20 (incentive schemes, approved): the desktop assessor's verification of one scheme application. Accept it (or return it to
 * the agency); then mark each answer the scheme asks to check and every document Valid or Not valid (with the remark the unit
 * corrects), see the totals (claimed / verified / eligible), and decide: Send for correction (round n of N; only with a Not valid),
 * Reject (a reason) or Recommend (everything checked and valid). 2026-11-20 (the product owner: "Auto-reject, can re-apply"): with no
 * correction round left the button reads "Reject (no correction round left)" and, after a confirmation, the application is rejected
 * automatically with the Not-valid remarks (the unit may apply again). Unsaved marks are saved before a decision.
 */
@Component({
  selector: 'zed-staff-scheme-verify',
  imports: [RouterLink, PageHead, SchemeSummary, SchemeAnswers, ConfirmDialog, TextPipe],
  host: { class: 'd-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="'Verify application' | t: 'staff.schemeVerification.verify.title'"
                   [subtitle]="detail() ? detail()!.application.schemeName + ' · ' + detail()!.application.zedId : null" />
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (detail(); as d) {
      @if (d.actions.accept) {
        <div class="zed-card sv-accept">
          <p class="m-0">{{ 'Your agency named you for this application. Accept it to verify it, or return it to your agency.' | t: 'staff.schemeVerification.verify.acceptText' }}</p>
          <div class="sv-btns">
            <button type="button" class="btn btn-outline-danger" (click)="ask('return')">{{ 'Return to agency' | t: 'staff.schemeVerification.action.return' }}</button>
            <button type="button" class="btn btn-primary" (click)="ask('accept')">{{ 'Accept' | t: 'staff.schemeVerification.action.accept' }}</button>
          </div>
        </div>
      }
      <zed-scheme-summary [detail]="d" />
      <zed-scheme-answers [sections]="d.sections" [editable]="d.actions.check" [(edits)]="edits" />
      @if (d.actions.check) {
        <div class="save-bar sv-bar" [class.is-dirty]="dirty()">
          <span class="me-auto sv-progress" data-progress>
            {{ 'Checked {done} of {all} · not valid {no}' | t: 'staff.schemeVerification.verify.progress' : { done: progress().done, all: progress().all, no: progress().no } }}
            @if (dirty()) { · <b>{{ 'Not saved yet.' | t: 'staff.schemeVerification.verify.unsaved' }}</b> }
          </span>
          <button type="button" class="btn btn-default" [disabled]="!dirty() || saving()" (click)="save()">{{ 'Save checks' | t: 'staff.schemeVerification.verify.save' }}</button>
          <button type="button" class="btn btn-outline-danger" [disabled]="saving()" (click)="ask('reject')">{{ 'Reject' | t: 'staff.schemeVerification.action.reject' }}</button>
          @if (roundsLeft() > 0) {
            <button type="button" class="btn btn-outline-primary" data-correction [disabled]="saving() || !canCorrect()" (click)="ask('correction')">
              {{ 'Send for correction (round {n} of {total})' | t: 'staff.schemeVerification.verify.correction' : { n: d.application.correctionRound + 1, total: d.application.correctionRounds } }}
            </button>
          } @else {
            <button type="button" class="btn btn-outline-danger" data-correction [disabled]="saving() || !canCorrect()" (click)="ask('correction')"
                    [attr.title]="'No correction round is left: points still not valid reject the application.' | t: 'staff.schemeVerification.verify.noRoundsTitle'">
              {{ 'Reject (no correction round left)' | t: 'staff.schemeVerification.verify.autoReject' }}
            </button>
          }
          <button type="button" class="btn btn-primary" [disabled]="saving() || !canRecommend()" (click)="ask('recommend')">{{ 'Recommend' | t: 'staff.schemeVerification.verify.recommend' }}</button>
        </div>
      }
      <a routerLink=".." class="btn btn-default mt-2">{{ 'Back to the list' | t: 'staff.schemeVerification.detail.back' }}</a>
    }
    @if (dialogs.current(); as dlg) {
      <zed-confirm-dialog [ask]="dlg.ask" [busy]="dialogs.busy()" [failed]="dialogs.failed()" inputId="sv-verify-text" (decided)="dialogs.confirm($event)" (cancel)="dialogs.close()" />
    }
    @if (loading()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .sv-accept { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 14px 18px; margin-bottom: 16px; background: #fdf8ec; }
    .sv-btns { display: flex; gap: 10px; }
    .sv-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; position: sticky; bottom: 0; z-index: 5; }
    .sv-progress { font-size: 13px; color: #17373b; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SchemeVerifyPage {
  private readonly api = inject(SchemeVerificationApi);
  private readonly toast = inject(ToastService);
  private readonly id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  protected readonly detail = signal<SchemeDetail | null>(null);
  protected readonly edits = signal<Record<string, CheckEdit>>({});
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly dialogs = new SchemeDialogs(this.toast, () => this.load());
  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.schemeVerification.assessor.title', 'Scheme Verification'), link: '..' },
    { label: this.detail()?.application.zedId ?? String(this.id) }));

  /** Every checkable answer / document of the page. */
  private readonly fields = computed<SchemeField[]>(() =>
    (this.detail()?.sections ?? []).flatMap((s) => s.items.flatMap((i) => i.fields)).filter((f) => !!f.path));

  /** The marks as shown: saved ones with the page's changes over them. */
  private readonly marks = computed(() => {
    const e = this.edits();
    return this.fields().map((f) => e[f.path!] ?? (f.check ? { status: f.check.status, remarks: f.check.remarks ?? '' } : null));
  });

  protected readonly dirty = computed(() => Object.keys(this.edits()).length > 0);
  protected readonly progress = computed(() => {
    const m = this.marks();
    return { done: m.filter((x) => !!x).length, all: m.length, no: m.filter((x) => x?.status === 'No').length };
  });
  protected readonly roundsLeft = computed(() => this.detail()?.actions.roundsLeft ?? 0);
  /** Correction with a Not valid: a new round while rounds are left, else the automatic rejection. */
  protected readonly canCorrect = computed(() => this.progress().no > 0);
  protected readonly canRecommend = computed(() => this.progress().no === 0 && this.progress().done === this.progress().all);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.detail.set(await firstValueFrom(this.api.detail('assessor', this.id)));
      this.edits.set({});
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Saves the changed marks; false (with the message shown) when one is incomplete or the server refuses. */
  protected async save(quiet = false): Promise<boolean> {
    const e = this.edits();
    const paths = Object.keys(e);
    if (paths.length === 0) return true;
    const missing = paths.find((p) => e[p].status === 'No' && !e[p].remarks.trim());
    if (missing) {
      this.error.set(t('staff.schemeVerification.verify.remarkRequired', 'Please write what is not valid for each answer or document marked Not valid.'));
      return false;
    }
    const checks: CheckInput[] = paths.map((p) => ({ path: p, status: e[p].status, remarks: e[p].status === 'No' ? e[p].remarks.trim() : null }));
    this.saving.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.api.saveChecks(this.id, checks));
      if (!quiet) this.toast.success(r.message);
      await this.load();
      return true;
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  protected async ask(kind: 'accept' | 'return' | 'correction' | 'reject' | 'recommend'): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const a = d.application;
    const ref = { id: a.id, zedId: a.zedId, unitName: a.unitName, schemeName: a.schemeName };
    if (kind === 'accept') { const x = schemeAsks.assessorAccept(this.api, ref); this.dialogs.open(x.ask, x.run); return; }
    if (kind === 'return') { const x = schemeAsks.assessorReturn(this.api, ref); this.dialogs.open(x.ask, x.run); return; }
    if (!(await this.save(true))) return;
    const now = this.detail()!;
    const sub = [a.zedId, a.unitName, a.schemeName].filter((x) => !!x).join(' · ');
    let ask: ConfirmAsk;
    switch (kind) {
      case 'correction':
        ask = now.actions.roundsLeft <= 0 ? {
          title: t('staff.schemeVerification.verify.autoRejectTitle', 'Reject: no correction round left'), subtitle: sub,
          message: t('staff.schemeVerification.verify.autoRejectMessage', 'All {total} correction round(s) are used and {count} point(s) are still Not valid. The application is rejected ("Not valid after the last correction round", with your remarks) and the unit is told by e-mail; it may apply again.',
            { total: now.application.correctionRounds, count: now.actions.notValid }),
          confirmLabel: t('staff.schemeVerification.dialog.rejectButton', 'Reject'), danger: true,
        } : {
          title: t('staff.schemeVerification.verify.correctionTitle', 'Send for correction'), subtitle: sub,
          message: t('staff.schemeVerification.verify.correctionMessage', 'Round {n} of {total}: the unit is e-mailed the {count} point(s) marked Not valid and must answer within {days} days, or the application is rejected.',
            { n: now.application.correctionRound + 1, total: now.application.correctionRounds, count: now.actions.notValid, days: now.application.correctionDays }),
          confirmLabel: t('staff.schemeVerification.verify.correctionButton', 'Send for correction'),
        };
        break;
      case 'reject':
        ask = {
          title: t('staff.schemeVerification.verify.rejectTitle', 'Reject the application'), subtitle: sub,
          message: t('staff.schemeVerification.verify.rejectMessage', 'The unit is told by e-mail; it may apply again while the scheme is open for it.'),
          reason: { label: t('staff.schemeVerification.dialog.reasonLabel', 'Reason for rejection'), maxLength: 1000 },
          confirmLabel: t('staff.schemeVerification.dialog.rejectButton', 'Reject'), danger: true,
        };
        break;
      default:
        ask = {
          title: t('staff.schemeVerification.verify.recommendTitle', 'Recommend the application'), subtitle: sub,
          message: t('staff.schemeVerification.verify.recommendMessage', 'Verified claim Rs. {verified}; eligible amount Rs. {eligible}. It goes to your agency for QC.',
            { verified: money(now.totals.verified), eligible: money(now.totals.eligible) }),
          confirmLabel: t('staff.schemeVerification.verify.recommend', 'Recommend'), icon: 'check',
        };
    }
    this.dialogs.open(ask, async (r) => (await firstValueFrom(this.api.decide(this.id, kind, kind === 'reject' ? r.reason : null))).message);
  }

  protected readonly day = day;
}
