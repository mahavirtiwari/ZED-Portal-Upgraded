import { Component, input } from '@angular/core';

/** One count of the strip: a number and what it counts. */
export interface ListCount {
  label: string;
  value: number;
  /** Colours the number: 'warn' (waiting on you), 'bad' (NC, rejected), 'good' (done). */
  tone?: 'warn' | 'bad' | 'good';
}

/** 2026-11-14 (approved frame A): the counts above a staff list (allotted, to accept, NC raised, ...). */
@Component({
  selector: 'zed-list-counts',
  host: { class: 'd-block' },
  template: `
    <div class="lc" role="list">
      @for (c of counts(); track c.label) {
        <div class="lc-item" role="listitem"><b [class]="c.tone ? 'is-' + c.tone : ''">{{ c.value }}</b><small>{{ c.label }}</small></div>
      }
    </div>
  `,
  styles: `
    .lc { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .lc-item { background: #fff; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 14px; }
    .lc-item b { display: block; font-size: 22px; font-weight: 800; color: #23474a; line-height: 1.1; }
    .lc-item b.is-warn { color: #a86a12; }
    .lc-item b.is-bad { color: #b03a2e; }
    .lc-item b.is-good { color: #1e7a3c; }
    .lc-item small { font-size: 12.5px; color: #7a8a8b; font-weight: 600; }
  `,
})
export class ListCounts {
  readonly counts = input.required<ListCount[]>();
}
