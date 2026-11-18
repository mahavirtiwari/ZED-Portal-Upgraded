import { DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, afterNextRender, inject, input, output } from '@angular/core';
import { TableExport } from '../table-export';
import { BlockHistoryEntry } from './users.api';

/** One line of the history panel: what changed, who did it and why, when. */
export interface HistoryItem {
  kind: 'status';
  title: string;
  /** "By Master Admin · Reason: …" */
  detail: string;
  at: string | null;
  tone: 'good' | 'bad' | 'info';
}

/** The block / unblock entries as panel lines (latest first, as the server sends them). */
export function blockHistoryItems(entries: readonly BlockHistoryEntry[], agencyWord = 'agency'): HistoryItem[] {
  const role = (r: number | null) => (r === 7 ? ' (Master Admin)' : r === 2 ? ` (${agencyWord})` : r === 1 ? ' (Admin)' : '');
  return entries.map((e) => {
    const parts = [e.actionBy ? `By ${e.actionBy}${role(e.actionByRole)}` : '', e.reason ? `Reason: ${e.reason}` : ''].filter(Boolean);
    return { kind: 'status', title: e.action, detail: parts.join(' · '), at: e.actionDate, tone: e.action === 'Blocked' ? 'bad' : 'good' };
  });
}

/**
 * 2026-11-17 (approved staff redesign, popup-08): the history of a login as a side panel on the right, so the list stays
 * visible behind it: each entry says what changed, who did it and why, with a CSV download. Today the portal records the
 * blocks and unblocks of a login (UserBlockHistory); allotments, reset links and profile edits are not kept per login, so
 * the panel shows the status entries only (the type filters of the design appear once there is more than one type).
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): popup-08 values: 520px, 19px title, a grey square close
 * button, 6px coloured dots on a 2px line, 14 / 12.5 / 11.5px entry lines, and a white footer with a top line (a div, not a
 * <code>footer</code>: the site's global footer rule painted it dark): Download (CSV) outlined with its icon, Close grey.
 */
@Component({
  selector: 'zed-user-history',
  imports: [DatePipe],
  template: `
    <div class="hp-back" (click)="closed.emit()"></div>
    <aside class="hp" role="dialog" aria-modal="true" aria-labelledby="hp-title">
      <header class="hp-head">
        <div>
          <h3 id="hp-title">History</h3>
          <small>{{ subtitle() }}</small>
        </div>
        <button type="button" class="hp-x" aria-label="Close history" (click)="closed.emit()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18 M6 6l12 12" /></svg></button>
      </header>
      <div class="hp-body">
        @if (error()) {
          <div class="alert alert-danger" role="alert">{{ error() }}</div>
        } @else if (items() === null) {
          <p class="hp-none" role="status">Loading…</p>
        } @else {
          <ol class="hp-list">
            @for (e of items(); track $index) {
              <li [class]="'is-' + e.tone">
                <strong>{{ e.title }}</strong>
                @if (e.detail) { <span>{{ e.detail }}</span> }
                @if (e.at) { <small>{{ e.at | date: 'dd MMM yyyy, HH:mm' }}</small> }
              </li>
            } @empty {
              <li class="hp-none">No block or unblock recorded yet.</li>
            }
          </ol>
          <p class="hp-note">Blocks and unblocks are recorded with their reason. Allotments, reset links and profile edits are not kept in this history.</p>
        }
      </div>
      <div class="hp-foot">
        <button type="button" class="btn btn-outline-primary hp-csv" [disabled]="!items()?.length" (click)="download()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" /></svg>Download (CSV)</button>
        <button type="button" class="btn btn-default hp-close" (click)="closed.emit()">Close</button>
      </div>
    </aside>
  `,
  styles: `
    .hp-back { position: fixed; inset: 0; z-index: 1065; background: rgba(15, 35, 38, 0.56); }
    .hp { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1066; width: min(520px, 100vw); display: flex; flex-direction: column; background: #fff;
      box-shadow: -12px 0 32px rgba(16, 61, 64, 0.2); }
    .hp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 24px 28px 20px; border-bottom: 1px solid #dde7e8; }
    .hp-head h3 { margin: 0; font-size: 19px; font-weight: 700; color: #17373b; }
    .hp-head small { display: block; margin-top: 4px; font-size: 12.5px; font-weight: 500; color: #6f8487; overflow-wrap: anywhere; }
    .hp-x { flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; display: grid; place-items: center; background: #eef3f3; color: #17373b; }
    .hp-x svg, .hp-csv svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .hp-x svg { width: 16px; height: 16px; }
    .hp-body { flex: 1; overflow: auto; padding: 24px 28px; }
    .hp-list { list-style: none; margin: 0 0 0 15px; padding: 0 0 0 21px; border-left: 2px solid #dde7e8; }
    .hp-list li { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 0 0 22px; font-size: 12.5px; font-weight: 500; color: #3d5559; overflow-wrap: anywhere; }
    .hp-list li::before { content: ''; position: absolute; left: -29px; top: 3px; width: 12px; height: 12px; border-radius: 50%; background: #3ba3ad; box-shadow: 0 0 0 2px #fff; }
    .hp-list li.is-good::before { background: #2f9e58; }
    .hp-list li.is-bad::before { background: #c8473c; }
    .hp-list strong { font-size: 14px; font-weight: 700; color: #17373b; }
    .hp-list small { font-size: 11.5px; color: #6f8487; }
    .hp-list li.hp-none::before { display: none; }
    .hp-none { color: #6f8487; }
    .hp-note { margin: 4px 0 0; font-size: 12px; font-weight: 500; color: #6f8487; }
    .hp-foot { flex: none; display: flex; justify-content: space-between; gap: 12px; padding: 14px 28px; border-top: 1px solid #dde7e8; background: #fff; color: inherit; }
    .hp-foot .btn { min-height: 40px; }
    .hp-csv { min-width: 180px; }
    .hp-csv svg { width: 16px; height: 16px; }
    .hp-close { min-width: 100px; }
  `,
})
export class UserHistoryPanel {
  /** "Assessor One · ZEDBA3653" */
  readonly subtitle = input('');
  /** null while loading. */
  readonly items = input<HistoryItem[] | null>(null);
  readonly error = input('');
  /** The CSV's name, e.g. "history-ZEDBA3653". */
  readonly fileName = input('history');
  readonly closed = output<void>();

  private readonly exporter = inject(TableExport);
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    afterNextRender(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.hp-x')?.focus());
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.closed.emit();
  }

  protected download(): void {
    const rows = (this.items() ?? []).map((e) => [e.at ?? '', e.title, e.detail]);
    this.exporter.csv(this.fileName(), { name: 'History', columns: ['Date', 'Event', 'Details'], rows });
  }
}
