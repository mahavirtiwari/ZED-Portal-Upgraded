import { Component, ElementRef, HostListener, afterNextRender, inject, input, output, signal } from '@angular/core';
import { EXPORT_SECTIONS, ExportChoice, ExportFormat, ExportSection } from './dashboard-export';

/**
 * 2026-11-17 (approved staff redesign, pop-up 07): "Export dashboard": the filters that apply, the sections to export and
 * the format. Excel and CSV hold the figures the dashboard has loaded; PDF is the picture of the page with the chosen
 * sections.
 */
@Component({
  selector: 'zed-dashboard-export',
  template: `
    <div class="xd-backdrop" (click)="close.emit()"></div>
    <div class="xd" role="dialog" aria-modal="true" aria-labelledby="xd-title" aria-describedby="xd-sub">
      <div class="xd-head">
        <span class="xd-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg></span>
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
    .xd-backdrop { position: fixed; inset: 0; background: rgba(16, 45, 48, .45); }
    .xd { position: relative; width: min(620px, 100%); background: #fff; border-radius: 14px; box-shadow: 0 20px 48px rgba(16, 45, 48, .3); }
    .xd-head { display: flex; align-items: center; gap: 14px; padding: 20px 24px 16px; border-bottom: 1px solid #e6eeee; }
    .xd-icon { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: #eef5f4; border: 1px solid #dbe8e7; }
    svg { width: 20px; height: 20px; fill: none; stroke: var(--zt-dark, #1f5c61); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .xd-titles { flex: 1; min-width: 0; }
    h2 { margin: 0; font-size: 19px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .xd-titles p { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
    .xd-close { flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: #eef3f3; display: grid; place-items: center; }
    .xd-close svg { width: 16px; height: 16px; stroke: #23474a; }
    .xd-body { padding: 8px 24px 20px; }
    h3 { margin: 16px 0 8px; font-size: 11.5px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; color: #4b5c5d; }
    .xd-chips { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
    .xd-chips li { background: #eef3f3; border-radius: 999px; padding: 4px 12px; font-size: 12.5px; color: var(--zt-ink, #173f44); }
    .xd-checks { display: grid; gap: 10px; }
    .xd-check { display: flex; align-items: center; gap: 10px; font-size: 14px; color: #232527; cursor: pointer; }
    .xd-check input { width: 18px; height: 18px; accent-color: var(--zt-dark, #1f5c61); }
    .xd-formats { display: inline-flex; flex-wrap: wrap; padding: 3px; border-radius: 10px; background: #eef3f3; }
    .xd-formats button { min-width: 120px; border: 2px solid transparent; border-radius: 8px; background: none; padding: 6px 14px; font-size: 13.5px; color: #4b5c5d; }
    .xd-formats button.on { background: #fff; border-color: var(--zt-dark, #1f5c61); color: var(--zt-ink, #173f44); font-weight: 700; }
    .xd-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 24px; border-top: 1px solid #e6eeee; }
    .xd-foot span { flex: 1; min-width: 180px; font-size: 13px; color: #5f6f70; }
    .xd-foot .btn { min-width: 110px; font-weight: 700; border-radius: 8px; padding: 8px 18px; text-transform: none; }
    .xd-cancel { background: #e8eff0; color: var(--zt-ink, #173f44); border: 0; }
    .xd-go { background: var(--zt-dark, #1f5c61); border-color: var(--zt-dark, #1f5c61); }
    @media (max-width: 575.98px) { :host { padding-top: 16px; } .xd-formats { display: flex; } .xd-formats button { flex: 1 1 0; min-width: 0; } }
  `,
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
