import { DatePipe } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { QoObservation, QualityApi, aboutLabels, severityLabel, statusLabel, stepLabel } from './quality.api';
import { TextPipe, t } from '../../content/page-text';

/**
 * 2026-11-16 (approved): one quality observation: severity, category, what and whom it is about, the text, its time
 * history (raised, replied, closed, reopened, with who and when), and the actions of the viewer (the agency's reply; the
 * ZED team's close / reopen). Used on the review pages' panel and on the Quality observations page.
 * 2026-11-17 (the user's staff design 14): the severity, category and status as chips, the parameter and whom it is about under
 * them; Reopen stays disabled until the reason is typed.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files', staff-14a rail): the severity and status chips on the first line
 * (the status no longer drops under a long title), the category on its own line; the close / reopen note a single-line field
 * with a grey Reopen beside it.
 */
@Component({
  selector: 'zed-qo-item',
  imports: [DatePipe, TextPipe],
  template: `
    @let o = item();
    <article class="qo" [attr.data-qo]="o.id" [attr.data-status]="o.status">
      <div class="qo-head">
        <span class="qo-chip" [attr.data-sev]="o.severity">{{ severityLabel(o.severity) }}</span>
        <span class="qo-status" [attr.data-status]="o.status">{{ statusLabel(o.status) }}</span>
      </div>
      <b class="qo-cat">{{ o.category }}</b>
      @if (showUnit()) { <div class="qo-unit">{{ o.zedId }} · {{ o.certification }}</div> }
      <div class="qo-ref">{{ o.refLabel || (o.refType === 'Overall' || !o.refType
        ? (handholding ? ('Whole milestone' | t: 'staff.quality.item.wholeMilestone.label') : ('Whole assessment' | t: 'staff.quality.item.wholeAssessment.label')) : o.refType) }}</div>
      <div class="qo-meta">
        {{ o.aboutName ? ('About {who}: {name}' | t: 'staff.quality.item.aboutNamed.label' : { who: aboutLabel(o), name: o.aboutName })
          : ('About {who}' | t: 'staff.quality.item.about.label' : { who: aboutLabel(o) }) }}
        @if (o.stage) { · {{ o.stage }}{{ o.stage === 'NC' && o.round ? ' ' + o.round : '' }} }
      </div>
      <p class="qo-text">{{ o.text }}</p>
      <button type="button" class="btn btn-link p-0 qo-toggle" [attr.aria-expanded]="open()" (click)="open.set(!open())">{{ open()
        ? ('Hide history ({count})' | t: 'staff.quality.item.hideHistory.button' : { count: o.history.length })
        : ('Show history ({count})' | t: 'staff.quality.item.showHistory.button' : { count: o.history.length }) }}</button>
      @if (open()) {
        <ol class="qo-history" data-qo-history>
          @for (h of o.history; track $index) {
            <li><b>{{ stepLabel(h.kind) }}</b> · {{ h.at | date: 'd MMM yyyy, h:mm a' }} · {{ h.byName || h.by }}@if (h.text) { <span class="d-block">{{ h.text }}</span> }</li>
          }
        </ol>
        <div class="qo-times">
          <!-- 2026-11-21 (Assessment Agency UI audit, item 9): closed with no reply says so instead of "Reply in —". -->
          @if (o.replyHours == null && o.status === 'Closed') {
            {{ 'Closed without a reply · closed in {close}' | t: 'staff.quality.item.closedNoReply.label' : { close: hoursOf(o.closeHours) } }}
          } @else if (o.replyHours == null) {
            {{ 'No reply yet' | t: 'staff.quality.item.noReply.label' }}
          } @else {
            {{ 'Reply in {reply} · closed in {close}' | t: 'staff.quality.item.times.label' : { reply: hoursOf(o.replyHours), close: hoursOf(o.closeHours) } }}
          }
          @if (o.reopens) { {{ '· reopened {count}×' | t: 'staff.quality.item.reopens.label' : { count: o.reopens } }} }
        </div>
      }
      @if (canRespond() && o.status !== 'Closed') {
        <div class="qo-act">
          <textarea class="form-control" rows="2" maxlength="2000" [attr.aria-label]="'Reply to observation {id}' | t: 'staff.quality.item.reply.aria' : { id: o.id }"
            [placeholder]="'Your reply' | t: 'staff.quality.item.reply.placeholder'"
            [value]="note()" (input)="note.set($any($event.target).value)"></textarea>
          <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || !note().trim()" (click)="act(api.respond(o.id, note().trim()))">{{ 'Reply' | t: 'staff.quality.item.reply.button' }}</button>
        </div>
      }
      @if (canClose()) {
        <div class="qo-act">
          <input type="text" class="form-control qo-note" maxlength="2000" [attr.aria-label]="'Note on observation {id}' | t: 'staff.quality.item.note.aria' : { id: o.id }"
            [placeholder]="o.status === 'Closed' ? ('Why it is reopened' | t: 'staff.quality.item.reopen.placeholder') : ('Note (optional)' | t: 'staff.quality.item.note.placeholder')"
            [value]="note()" (input)="note.set($any($event.target).value)" />
          <!-- Reopen stays disabled until the reason is typed. -->
          @if (o.status === 'Closed') {
            <button type="button" class="btn btn-light btn-sm qo-reopen" [disabled]="busy() || !note().trim()" (click)="act(api.reopen(o.id, note().trim()))">{{ 'Reopen' | t: 'staff.quality.item.reopen.button' }}</button>
          } @else {
            <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy()" (click)="act(api.close(o.id, note().trim() || null))">{{ 'Close' | t: 'staff.quality.item.close.button' }}</button>
          }
        </div>
      }
      @if (error()) { <div class="alert alert-danger py-1 mt-2 mb-0" role="alert">{{ error() }}</div> }
    </article>
  `,
  styles: `
    .qo { border: 1px solid #e3eaea; border-left: 4px solid #d97706; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; background: #fff; }
    .qo[data-status='Responded'] { border-left-color: var(--zt-mid2, #2a8a8c); }
    .qo[data-status='Closed'] { border-left-color: #2e9e57; background: #fbfdfc; }
    .qo-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .qo-chip { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; border-radius: 10px; padding: 2px 9px; background: #eef2f2; color: #3f4754; }
    .qo-chip[data-sev='Minor'] { background: #e6f2f3; color: var(--zt-dark, #1f5c61); }
    .qo-chip[data-sev='Major'] { background: #fdf3e1; color: #8a5a00; }
    .qo-chip[data-sev='Critical'] { background: #fdecec; color: #a8303a; }
    .qo-cat { display: block; margin-top: 8px; font-size: 13.5px; font-weight: 700; color: #17373b; overflow-wrap: anywhere; }
    .qo-status { margin-left: auto; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; border-radius: 10px; padding: 2px 9px;
      background: #fdf3e1; color: #8a5a00; }
    .qo-status[data-status='Responded'] { background: #e6f2f3; color: var(--zt-dark, #1f5c61); }
    .qo-status[data-status='Closed'] { background: #e3f4e8; color: #1e7d43; }
    .qo-unit { font-size: 12px; color: var(--zt-mid2, #2a8a8c); font-weight: 600; margin-top: 4px; }
    .qo-ref { font-size: 12.5px; font-weight: 500; color: #17373b; margin-top: 2px; overflow-wrap: anywhere; }
    .qo-meta { font-size: 12.5px; color: #5f6f70; margin-top: 2px; }
    .qo-text { margin: 6px 0 4px; font-size: 13.5px; white-space: pre-line; overflow-wrap: anywhere; }
    .qo-toggle { font-size: 13px; font-weight: 600; color: var(--zt-dark, #1f5c61); text-decoration: none; }
    .qo-history { font-size: 12px; margin: 6px 0 0; padding-left: 18px; color: #3f4754; }
    .qo-times { font-size: 12px; color: #5f6f70; margin-top: 4px; }
    .qo-act { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; }
    .qo-act textarea { min-height: 0; height: auto; font-size: 13px; border-radius: 8px; }
    .qo-act .qo-note { height: 30px; font-size: 12.5px; border-radius: 8px; }
    .qo-act .qo-reopen { min-width: 76px; height: 30px; background: #e3e9e9; border-color: #e3e9e9; color: #17373b; }
    .qo-act .btn { border-radius: 8px; font-weight: 600; white-space: nowrap; }
  `,
})
export class QualityObservationItem {
  protected readonly api = inject(QualityApi);
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly handholding = this.system === 'consultancy';
  protected readonly severityLabel = severityLabel;
  protected readonly statusLabel = statusLabel;
  protected readonly stepLabel = stepLabel;

  readonly item = input.required<QoObservation>();
  readonly canRespond = input(false);
  readonly canClose = input(false);
  /** On the list page: the unit's ZED ID and level. */
  readonly showUnit = input(false);
  /** After a reply / close / reopen: the message (the owner reloads). */
  readonly changed = output<string>();

  protected readonly open = signal(false);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected aboutLabel(o: QoObservation): string {
    return (o.about && aboutLabels(this.system)[o.about]) || t('staff.quality.item.aboutAssessment.label', 'the assessment');
  }

  /** "12 h", or — when not yet. */
  protected hoursOf(h: number | null | undefined): string {
    return h != null ? t('staff.quality.time.hours.label', '{count} h', { count: h }) : '—';
  }

  protected async act(call: Observable<{ message: string }>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(call);
      this.note.set('');
      this.changed.emit(r.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
