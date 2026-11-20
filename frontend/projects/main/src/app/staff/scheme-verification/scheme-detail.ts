import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { ConfirmDialog } from '../confirm-dialog';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { SchemeAnswers, SchemeSummary } from './scheme-parts';
import { SchemeDialogs, day, schemeAsks } from './scheme-shared';
import { SchemeDetail, SchemeVerificationApi } from './scheme-verification.api';

type Mode = 'admin' | 'allotment' | 'qc';

/**
 * 2026-11-20 (incentive schemes, approved): one scheme application for the Master Admin (allot / re-allot, resume or reject one on
 * hold) and its agency (accept naming an assessor or reject; QC: approve an amount or back to the assessor): the facts, totals,
 * the answers and documents with the assessor's checks, and the history.
 */
@Component({
  selector: 'zed-staff-scheme-detail',
  imports: [RouterLink, PageHead, SchemeSummary, SchemeAnswers, ConfirmDialog, TextPipe],
  host: { class: 'd-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="detail()?.application?.schemeName ?? ('Scheme application' | t: 'staff.schemeVerification.detail.title')"
                   [subtitle]="detail() ? detail()!.application.zedId + ' · ' + (detail()!.application.unitName ?? '') : null" />
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (detail(); as d) {
      <div class="sd-bar">
        <a routerLink=".." class="btn btn-default">{{ 'Back to the list' | t: 'staff.schemeVerification.detail.back' }}</a>
        <span class="me-auto"></span>
        @if (d.actions.allot) {
          <button type="button" class="btn btn-primary" (click)="act('allot')">{{ d.application.agency ? ('Re-allot' | t: 'staff.schemeVerification.action.reallot') : ('Allot' | t: 'staff.schemeVerification.action.allot') }}</button>
        }
        @if (d.actions.hold) {
          <button type="button" class="btn btn-outline-danger" (click)="act('rejectHold')">{{ 'Reject' | t: 'staff.schemeVerification.action.reject' }}</button>
          <button type="button" class="btn btn-primary" (click)="act('resume')">{{ 'Resume' | t: 'staff.schemeVerification.action.resume' }}</button>
        }
        @if (d.actions.respond) {
          <button type="button" class="btn btn-outline-danger" (click)="act('reject')">{{ 'Reject' | t: 'staff.schemeVerification.action.reject' }}</button>
          <button type="button" class="btn btn-primary" (click)="act('accept')">{{ 'Accept' | t: 'staff.schemeVerification.action.accept' }}</button>
        }
        @if (d.actions.qc) {
          <button type="button" class="btn btn-outline-primary" (click)="act('back')">{{ 'Back to assessor' | t: 'staff.schemeVerification.action.back' }}</button>
          <button type="button" class="btn btn-primary" (click)="act('approve')">{{ 'Approve' | t: 'staff.schemeVerification.action.approve' }}</button>
        }
      </div>
      <zed-scheme-summary [detail]="d" />
      <zed-scheme-answers [sections]="d.sections" />
      @if (d.history.length) {
        <section class="zed-card sd-hist" aria-labelledby="sd-hist-h">
          <h4 id="sd-hist-h">{{ 'History' | t: 'staff.schemeVerification.detail.history' }}</h4>
          <ul>
            @for (h of d.history; track $index) { <li><small>{{ day(h.on) }}</small> {{ h.text }}</li> }
          </ul>
        </section>
      }
    }
    @if (dialogs.current(); as dlg) {
      <zed-confirm-dialog [ask]="dlg.ask" [busy]="dialogs.busy()" [failed]="dialogs.failed()" inputId="sd-dialog-text" (decided)="dialogs.confirm($event)" (cancel)="dialogs.close()" />
    }
    @if (loading()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .sd-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
    .sd-hist { padding: 16px 20px; }
    .sd-hist h4 { font-size: 16px; }
    .sd-hist ul { margin: 0; padding-left: 18px; font-size: 13px; }
    .sd-hist small { color: #5f6f70; margin-right: 6px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SchemeDetailPage {
  private readonly api = inject(SchemeVerificationApi);
  private readonly route = inject(ActivatedRoute);
  private readonly mode: Mode = (this.route.snapshot.data['mode'] as Mode) ?? 'admin';
  private readonly id = Number(this.route.snapshot.paramMap.get('id'));
  protected readonly detail = signal<SchemeDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly dialogs = new SchemeDialogs(inject(ToastService), () => this.load());
  protected readonly day = day;

  protected readonly crumbs = computed(() => {
    const list = this.mode === 'allotment' ? t('staff.schemeVerification.allotment.title', 'Scheme Allotment')
      : this.mode === 'qc' ? t('staff.schemeVerification.qc.title', 'Scheme QC')
      : t('staff.schemeVerification.admin.title', 'Scheme Applications');
    return staffCrumbs({ label: list, link: '..' }, { label: this.detail()?.application.zedId ?? String(this.id) });
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.detail.set(await firstValueFrom(this.api.detail(this.mode === 'admin' ? 'admin' : 'agency', this.id)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async act(key: 'allot' | 'resume' | 'rejectHold' | 'accept' | 'reject' | 'approve' | 'back'): Promise<void> {
    const d = this.detail();
    if (!d) return;
    const a = d.application;
    const ref = { id: a.id, zedId: a.zedId, unitName: a.unitName, schemeName: a.schemeName, agency: a.agency?.userId ?? null, eligibleAmount: d.totals.eligible };
    this.loading.set(true);
    try {
      const dlg = key === 'allot' ? await schemeAsks.allot(this.api, ref)
        : key === 'resume' ? schemeAsks.resume(this.api, ref)
        : key === 'rejectHold' ? schemeAsks.rejectOnHold(this.api, ref)
        : key === 'accept' ? await schemeAsks.accept(this.api, ref)
        : key === 'reject' ? await schemeAsks.agencyReject(this.api, ref)
        : key === 'approve' ? schemeAsks.approve(this.api, ref)
        : schemeAsks.back(this.api, ref);
      this.dialogs.open(dlg.ask, dlg.run);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
