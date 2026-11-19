import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AuthService } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ChecklistRecord, SubmissionChecklistApi } from './quality.api';
import { TextPipe, t } from '../../content/page-text';

/**
 * 2026-11-17 (approved): the submission checklists ticked with an assessment's (milestone's) submissions, on its review pages:
 * one line per submission (who, as what, when), opened to the items as they were worded when ticked. Hidden when there is none
 * or the login may not see them.
 */
@Component({
  selector: 'zed-checklist-records',
  imports: [DatePipe, TextPipe],
  template: `
    @if (records().length) {
      <section class="cr" data-checklist-records>
        @for (r of records(); track r.id) {
          <div class="cr-row" [attr.data-record]="r.id">
            <button type="button" class="cr-head" [attr.aria-expanded]="open() === r.id" (click)="open.set(open() === r.id ? null : r.id)">
              <!-- One wording per line (with or without the stage and the time); the checklist's title is the Admin's. -->
              <span>
                @if (r.at) {
                  {{ r.stage ? ('{title} ({stage}) confirmed by {who} on {at}' | t: 'staff.submissionChecklist.record.stageAt.label' : { title: r.title, stage: r.stage, who: who(r), at: (r.at | date: 'd MMM y, HH:mm') })
                    : ('{title} confirmed by {who} on {at}' | t: 'staff.submissionChecklist.record.at.label' : { title: r.title, who: who(r), at: (r.at | date: 'd MMM y, HH:mm') }) }}
                } @else {
                  {{ r.stage ? ('{title} ({stage}) confirmed by {who}' | t: 'staff.submissionChecklist.record.stage.label' : { title: r.title, stage: r.stage, who: who(r) })
                    : ('{title} confirmed by {who}' | t: 'staff.submissionChecklist.record.label' : { title: r.title, who: who(r) }) }}
                }
              </span>
              <span class="cr-count">{{ r.items.length === 1 ? ('{count} item' | t: 'staff.submissionChecklist.record.item.label' : { count: 1 })
                : ('{count} items' | t: 'staff.submissionChecklist.record.items.label' : { count: r.items.length }) }} {{ open() === r.id ? '▴' : '▾' }}</span>
            </button>
            @if (open() === r.id) {
              <ol class="cr-items">@for (i of r.items; track $index) { <li>{{ i }}</li> }</ol>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .cr { border: 1px solid #e3eaea; border-radius: 12px; padding: 4px 12px; margin: 12px 0; background: #fff; }
    .cr-row + .cr-row { border-top: 1px solid #eef3f3; }
    .cr-head { display: flex; justify-content: space-between; gap: 10px; width: 100%; background: none; border: 0; padding: 8px 0; text-align: start; font-size: 13px; color: #23474a; }
    .cr-head b { font-weight: 600; }
    .cr-count { color: #2c7a7f; white-space: nowrap; }
    .cr-items { font-size: 13px; color: #3d4f50; margin: 0 0 8px; padding-left: 20px; }
  `,
})
export class ChecklistRecords {
  private readonly api = inject(SubmissionChecklistApi);
  private readonly auth = inject(AuthService);
  /** Master Admin, agency, assessor / consultant, Super Admin, Ministry: the logins the API answers. */
  private static readonly Roles = [7, 2, 3, 10, 8];

  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();
  /** Changed by the page after a submission so the new line shows. */
  readonly refresh = input(0);

  protected readonly records = signal<ChecklistRecord[]>([]);
  protected readonly open = signal<number | null>(null);
  /** There is something to show (2026-11-17: the details pages give the right rail its column only then). */
  readonly shown = computed(() => this.records().length > 0);

  /** Who confirmed: the name and role ("R Sharma, Lead assessor"), or whichever is known. */
  protected who(r: ChecklistRecord): string {
    return r.byName && r.role ? t('staff.submissionChecklist.record.who.label', '{name}, {role}', { name: r.byName, role: r.role }) : (r.byName || r.role || '');
  }

  constructor() {
    effect(() => {
      const z = this.zedId();
      const c = this.certification();
      this.refresh();
      if (z && c) untracked(() => void this.load(z, c));
    });
  }

  private async load(zedId: string, certification: string): Promise<void> {
    if (!ChecklistRecords.Roles.includes(this.auth.currentUser()?.roleId ?? 0)) return;
    try {
      this.records.set(await firstValueFrom(this.api.records(zedId, certification)));
    } catch {
      this.records.set([]);
    }
  }
}
