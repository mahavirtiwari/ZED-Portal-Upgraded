import { Component, input } from '@angular/core';

type Row = Record<string, unknown>;

/** One fact of the strip: a label and its value (a fact without a value is left out). */
export interface Fact {
  label: string;
  value: unknown;
}

/**
 * 2026-11-14 (approved): the key facts strip on top of the report pages (Basic information, Non-conformances, Site
 * assessment) in place of the live portal's unit side bar: the unit, UDYAM, ZED ID and the page's own facts.
 */
@Component({
  selector: 'zed-unit-facts',
  host: { class: 'd-block' },
  template: `
    <div class="uf">
      <div class="uf-unit">
        <span class="uf-label">Unit</span>
        <b>{{ msme()['EnterpriseName'] }}</b>
        @if (msme()['PUnitName']) { <small>{{ msme()['PUnitName'] }}</small> }
      </div>
      <div><span class="uf-label">UDYAM</span><b>{{ udyam() || '—' }}</b></div>
      <div><span class="uf-label">ZED ID</span><b>{{ msme()['ZedId'] }}</b></div>
      @for (f of extra(); track f.label) {
        @if (f.value !== null && f.value !== undefined && f.value !== '') { <div><span class="uf-label">{{ f.label }}</span><b>{{ f.value }}</b></div> }
      }
    </div>
  `,
  styles: `
    .uf { display: grid; grid-template-columns: minmax(0, 2fr) repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .uf > div { background: #fff; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; min-width: 0; }
    .uf-label { display: block; font-size: 11.5px; font-weight: 600; color: #7a8a8b; letter-spacing: .03em; }
    .uf b { display: block; font-size: 14px; color: #23474a; overflow-wrap: anywhere; }
    .uf small { display: block; font-size: 12px; color: #5f6f70; overflow-wrap: anywhere; }
    @media (max-width: 767.98px) { .uf { grid-template-columns: repeat(2, minmax(0, 1fr)); } .uf-unit { grid-column: 1 / -1; } }
  `,
})
export class UnitFacts {
  readonly msme = input.required<Row>();
  readonly udyam = input<unknown>('');
  /** The page's own facts after UDYAM and ZED ID (the level, the assessment date, ...). */
  readonly extra = input<Fact[]>([]);
}
