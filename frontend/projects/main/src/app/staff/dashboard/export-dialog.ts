import { Component, ElementRef, HostListener, afterNextRender, inject, input, output, signal } from '@angular/core';
import { EXPORT_SECTIONS, ExportChoice, ExportFormat, ExportSection } from './dashboard-export';

/**
 * 2026-11-17 (approved staff redesign, pop-up 07): "Export dashboard": the filters that apply, the sections to export and
 * the format. Excel and CSV hold the figures the dashboard has loaded; PDF is the picture of the page with the chosen
 * sections.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): sizes and colours of staff-popup-07 (18/700 title, 20px
 * teal checkboxes 38px apart, 13.5/600 options, 40px buttons). "Unit-level rows" is not offered: see EXPORT_SECTIONS.
 */
@Component({
  selector: 'zed-dashboard-export',
  template: `
    <div class="xd-backdrop" (click)="close.emit()"></div>
    <div class="xd" role="dialog" aria-modal="true" aria-labelledby="xd-title" aria-describedby="xd-sub">
      <div class="xd-head">
        <span class="xd-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg></span>
        <div class="xd-titles">
          <h2 id="xd-title">Export dashboard</h2>
          <p id="xd-sub">Uses the filters applied on the dashboard.</p>
        </div>
        <button type="button" class="xd-close" aria-label="Close" (click)="close.emit()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </div>
      <div class="xd-body">
        <h3>Filters applied</h3>
        <ul class="xd-chips">@for (f of filters(); track f) { <li>{{ f }}</li> }</ul>
        <h3 id="xd-what">What to export</h3>
        <div class="xd-checks" role="group" aria-labelledby="xd-what">
          @for (s of sections; track s.key) {
            <label class="xd-check"><input type="checkbox" [attr.data-section]="s.key" [checked]="picked().includes(s.key)" (change)="toggle(s.key)" /> {{ s.label }}</label>
          }
        </div>
        <h3 id="xd-format">Format</h3>
        <div class="xd-formats" role="radiogroup" aria-labelledby="xd-format">
          @for (f of formats; track f.key) {
            <button type="button" role="radio" [attr.data-format]="f.key" [class.on]="format() === f.key" [attr.aria-checked]="format() === f.key" (click)="format.set(f.key)">{{ f.label }}</button>
          }
        </div>
        @if (error()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ error() }}</div> }
      </div>
      <div class="xd-foot">
        <span>The file downloads to your computer.</span>
        <button type="button" class="btn xd-cancel" (click)="close.emit()">Cancel</button>
        <button type="button" class="btn btn-primary xd-go" [disabled]="busy() || !picked().length" (click)="run()">{{ busy() ? 'Exporting…' : 'Export' }}</button>
      </div>
    </div>
  `,
  styles: `
    :host { position: fixed; inset: 0; z-index: 1060; display: flex; align-items: flex-start; justify-content: center; padding: 72px 16px 16px; overflow: auto; }
    .xd-backdrop { position: fixed; inset: 0; background: rgba(15, 35, 38, .56); }
    .xd { position: relative; width: min(620px, 100%); background: #fff; border-radius: 16px; box-shadow: 0 20px 48px rgba(16, 45, 48, .3); }
    .xd-head { display: flex; align-items: center; gap: 14px; padding: 20px 24px 18px; border-bottom: 1px solid #dde7e8; }
    .xd-icon { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: #e6f2f3; }
    svg { width: 20px; height: 20px; fill: none; stroke: #24666b; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .xd-titles { flex: 1; min-width: 0; }
    h2 { margin: 0; font-size: 18px; font-weight: 700; color: #17373b; }
    .xd-titles p { margin: 3px 0 0; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .xd-close { flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: #eef3f3; display: grid; place-items: center; }
    .xd-close svg { width: 16px; height: 16px; stroke: #17373b; }
    .xd-body { padding: 8px 28px 26px; }
    h3 { margin: 22px 0 10px; font-size: 10.5px; font-weight: 800; letter-spacing: .9px; text-transform: uppercase; color: #6f8487; }
    .xd-chips { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
    .xd-chips li { display: inline-flex; align-items: center; height: 26px; background: #eef3f3; border-radius: 13px; padding: 0 12px; font-size: 12px; font-weight: 600; color: #17373b; }
    .xd-checks { display: grid; gap: 18px; padding-top: 4px; }
    .xd-check { display: flex; align-items: center; gap: 12px; margin: 0; font-size: 13.5px; font-weight: 600; line-height: 20px; color: #17373b; cursor: pointer; }
    .xd-check input { flex: none; appearance: none; width: 20px; height: 20px; margin: 0; border: 1.5px solid #24666b; border-radius: 5px; background: #fff center / 14px no-repeat; cursor: pointer; }
    .xd-check input:checked { background-color: #24666b; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M3 7l3 3 5-6' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
    .xd-check input:focus-visible { outline: 2px solid #24666b; outline-offset: 2px; }
    .xd-formats { display: inline-flex; flex-wrap: wrap; gap: 6px; padding: 3px; border-radius: 9px; background: #eef3f3; }
    .xd-formats button { min-width: 124px; height: 30px; border: 1.5px solid transparent; border-radius: 7px; background: none; padding: 0 14px; font-size: 13px; font-weight: 500; color: #6f8487; }
    .xd-formats button.on { background: #fff; border-color: #24666b; color: #24666b; font-weight: 700; }
    .xd-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 28px; border-top: 1px solid #dde7e8; }
    .xd-foot span { flex: 1; min-width: 180px; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .xd-foot .btn { height: 40px; font-size: 13.5px; font-weight: 700; border-radius: 9px; padding: 0 18px; text-transform: none; }
    .xd-cancel { min-width: 110px; background: #e7eeee; color: #17373b; border: 0; }
    .xd-go { min-width: 130px; background: #24666b; border-color: #24666b; }
    @media (max-width: 575.98px) { :host { padding-top: 16px; } .xd-formats { display: flex; } .xd-formats button { flex: 1 1 0; min-width: 0; } }`,
})
export class DashboardExportDialog {
  /** The filters that apply, as chips ("By registration date", "State: All", ...). */
  readonly filters = input<string[]>([]);
  readonly busy = input(false);
  readonly error = input('');
  readonly export = output<ExportChoice>();
  readonly close = output<void>();

  protected readonly sections = EXPORT_SECTIONS;
  protected readonly formats: { key: ExportFormat; label: string }[] = [
    { key: 'xlsx', label: 'Excel (.xlsx)' }, { key: 'csv', label: 'CSV' }, { key: 'pdf', label: 'PDF' },
  ];
  protected readonly picked = signal<ExportSection[]>(EXPORT_SECTIONS.map((s) => s.key));
  protected readonly format = signal<ExportFormat>('xlsx');

  constructor() {
    const host = inject(ElementRef<HTMLElement>);
    afterNextRender(() => (host.nativeElement.querySelector('.xd-close') as HTMLElement | null)?.focus());
  }

  protected toggle(key: ExportSection): void {
    this.picked.update((p) => (p.includes(key) ? p.filter((k) => k !== key) : EXPORT_SECTIONS.map((s) => s.key).filter((k) => k === key || p.includes(k))));
  }

  protected run(): void {
    if (this.picked().length && !this.busy()) this.export.emit({ sections: this.picked(), format: this.format() });
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    if (!this.busy()) this.close.emit();
  }
}
