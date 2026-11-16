import { DatePipe } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { QoObservation, QualityApi, aboutLabels } from './quality.api';

/**
 * 2026-11-16 (approved): one quality observation: severity, category, what and whom it is about, the text, its time
 * history (raised, replied, closed, reopened, with who and when), and the actions of the viewer (the agency's reply; the
 * ZED team's close / reopen). Used on the review pages' panel and on the Quality observations page.
 */
@Component({
  selector: 'zed-qo-item',
  imports: [DatePipe],
  template: `
    @let o = item();
    <article class="qo" [attr.data-qo]="o.id" [attr.data-status]="o.status">
      <div class="qo-head">
        <span class="qo-chip" [attr.data-sev]="o.severity">{{ o.severity }}</span>
        <span class="qo-chip cat">{{ o.category }}</span>
        <span class="qo-status" [attr.data-status]="o.status">{{ o.status }}</span>
        @if (showUnit()) { <span class="qo-unit">{{ o.zedId }} · {{ o.certification }}</span> }
      </div>
      <div class="qo-meta">
        {{ o.refLabel || (o.refType === 'Overall' || !o.refType ? (handholding ? 'Whole milestone' : 'Whole assessment') : o.refType) }}
        · about {{ aboutLabel(o) }}{{ o.aboutName ? ': ' + o.aboutName : '' }}
        @if (o.stage) { · {{ o.stage }}{{ o.stage === 'NC' && o.round ? ' ' + o.round : '' }} }
      </div>
      <p class="qo-text">{{ o.text }}</p>
      <button type="button" class="btn btn-link p-0 qo-toggle" (click)="open.set(!open())">{{ open() ? 'Hide' : 'Show' }} history ({{ o.history.length }})</button>
      @if (open()) {
        <ol class="qo-history" data-qo-history>
          @for (h of o.history; track $index) {
            <li><b>{{ h.kind }}</b> · {{ h.at | date: 'd MMM yyyy, h:mm a' }} · {{ h.byName || h.by }}@if (h.text) { <span class="d-block">{{ h.text }}</span> }</li>
          }
        </ol>
        <div class="qo-times">
          Reply in {{ o.replyHours != null ? o.replyHours + ' h' : '—' }} · closed in {{ o.closeHours != null ? o.closeHours + ' h' : '—' }}
          @if (o.reopens) { · reopened {{ o.reopens }}× }
        </div>
      }
      @if (canRespond() && o.status !== 'Closed') {
        <div class="qo-act">
          <textarea class="form-control" rows="2" maxlength="2000" [attr.aria-label]="'Reply to observation ' + o.id" placeholder="Your reply"
            [value]="note()" (input)="note.set($any($event.target).value)"></textarea>
          <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() || !note().trim()" (click)="act(api.respond(o.id, note().trim()))">REPLY</button>
        </div>
      }
      @if (canClose()) {
        <div class="qo-act">
          <textarea class="form-control" rows="1" maxlength="2000" [attr.aria-label]="'Note on observation ' + o.id"
            [placeholder]="o.status === 'Closed' ? 'Why it is reopened (required)' : 'Note (optional)'" [value]="note()" (input)="note.set($any($event.target).value)"></textarea>
          @if (o.status === 'Closed') {
            <button type="button" class="btn btn-outline-danger btn-sm" [disabled]="busy() || !note().trim()" (click)="act(api.reopen(o.id, note().trim()))">REOPEN</button>
          } @else {
            <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy()" (click)="act(api.close(o.id, note().trim() || null))">CLOSE</button>
          }
        </div>
      }
      @if (error()) { <div class="alert alert-danger py-1 mt-2 mb-0" role="alert">{{ error() }}</div> }
    </article>
  `,
  styles: `
    .qo { border: 1px solid #e3eaea; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: #fff; }
    .qo[data-status='Open'] { border-left: 4px solid #d97706; }
    .qo[data-status='Responded'] { border-left: 4px solid #1b75bb; }
    .qo[data-status='Closed'] { border-left: 4px solid #2e9e4b; }
    .qo-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .qo-chip { font-size: 11.5px; font-weight: 700; border-radius: 10px; padding: 1px 8px; background: #f2f4f4; color: #3f4754; }
    .qo-chip[data-sev='Minor'] { background: #e4f0fa; color: #1b75bb; }
    .qo-chip[data-sev='Major'] { background: #fef3c7; color: #8a6100; }
    .qo-chip[data-sev='Critical'] { background: #fdecec; color: #a8303a; }
    .qo-status { margin-left: auto; font-size: 12px; font-weight: 600; color: #5f6f70; }
    .qo-unit { font-size: 12px; color: var(--zt-mid2, #2f7c83); font-weight: 600; }
    .qo-meta { font-size: 12px; color: #5f6f70; margin-top: 4px; }
    .qo-text { margin: 6px 0 2px; white-space: pre-line; }
    .qo-toggle { font-size: 12px; }
    .qo-history { font-size: 12px; margin: 6px 0 0; padding-left: 18px; color: #3f4754; }
    .qo-times { font-size: 12px; color: #5f6f70; margin-top: 4px; }
    .qo-act { display: flex; gap: 8px; align-items: flex-start; margin-top: 8px; }
    .qo-act textarea { min-height: 0; height: auto; font-size: 13px; }
  `,
})
export class QualityObservationItem {
  protected readonly api = inject(QualityApi);
  private readonly labels = aboutLabels(inject(ASSESSMENT_SYSTEM));
  protected readonly handholding = inject(ASSESSMENT_SYSTEM) === 'consultancy';

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
    return (o.about && this.labels[o.about]) || 'the assessment';
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
