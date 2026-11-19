import { Component, computed, input, model } from '@angular/core';
import { ChecklistItem } from './quality.api';
import { TextPipe } from '../../content/page-text';

/** Whether every item asked is ticked (true when nothing is asked). */
export function allTicked(items: readonly ChecklistItem[], ticked: readonly string[]): boolean {
  return items.every((i) => ticked.includes(i.id));
}

/**
 * 2026-11-17 (approved): the Admin's submission checklist inside a final-submit / quality-check pop-up (Admin → Submission
 * checklists). Every item must be ticked before the pop-up's SUBMIT; the server checks the ticks again and records them with the
 * submission. Shows nothing when the Admin's list asks nothing at this stage.
 */
@Component({
  selector: 'zed-submit-checklist',
  imports: [TextPipe],
  template: `
    @if (items().length) {
      <div class="sc" data-submit-checklist>
        <p class="sc-hint">{{ 'Tick every item to submit. Your ticks are recorded with this submission.' | t: 'staff.submissionChecklist.note' }}</p>
        @for (i of items(); track i.id) {
          <label class="sc-item">
            <input type="checkbox" class="form-check-input" [attr.data-check]="i.id" [checked]="ticked().includes(i.id)"
              (change)="toggle(i.id, $any($event.target).checked)" />
            <span>{{ i.text }}</span>
          </label>
        }
        <small class="sc-count" data-checklist-count>{{ '{ticked} of {total} ticked' | t: 'staff.submissionChecklist.ticked.label' : { ticked: count(), total: items().length } }}</small>
      </div>
    }
  `,
  styles: `
    .sc { text-align: start; }
    .sc-hint { font-size: 13px; color: #5f6f70; margin: 0 0 6px; }
    .sc-item { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; border-top: 1px solid #e6eded; font-size: 14px; cursor: pointer; margin: 0; }
    .sc-item:first-of-type { border-top: 0; }
    .sc-item input { margin-top: 3px; flex: 0 0 auto; }
    .sc-count { display: block; color: #5f6f70; margin-top: 6px; }
  `,
})
export class SubmitChecklist {
  readonly items = input<ChecklistItem[]>([]);
  /** The ids of the ticked items (two-way). */
  readonly ticked = model<string[]>([]);

  protected readonly count = computed(() => this.items().filter((i) => this.ticked().includes(i.id)).length);

  protected toggle(id: string, on: boolean): void {
    const rest = this.ticked().filter((t) => t !== id);
    this.ticked.set(on ? [...rest, id] : rest);
  }
}
