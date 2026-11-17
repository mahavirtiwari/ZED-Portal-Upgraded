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
        <button type="button" class="hp-x" aria-label="Close history" (click)="closed.emit()">×</button>
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
      <footer class="hp-foot">
        <button type="button" class="btn btn-outline-primary" [disabled]="!items()?.length" (click)="download()">Download (CSV)</button>
        <button type="button" class="btn btn-ph hp-close" (click)="closed.emit()">Close</button>
      </footer>
    </aside>
  `,
  styles: `
    .hp-back { position: fixed; inset: 0; z-index: 1065; background: rgba(23, 47, 50, 0.45); }
    .hp { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1066; width: min(520px, 100vw); display: flex; flex-direction: column; background: #fff;
      box-shadow: -12px 0 32px rgba(16, 61, 64, 0.2); }
    .hp-head { display: flex; justify-content: space-between; gap: 12px; padding: 22px 24px 14px; border-bottom: 1px solid #e6eeee; }
    .hp-head h3 { margin: 0; font-size: 20px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .hp-head small { color: #5f6f70; overflow-wrap: anywhere; }
    .hp-x { flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: #eef3f3; font-size: 22px; line-height: 1; color: var(--zt-ink, #173f44); }
    .hp-body { flex: 1; overflow: auto; padding: 18px 24px; }
    .hp-list { list-style: none; margin: 0; padding: 0 0 0 22px; border-left: 2px solid #e6eeee; }
    .hp-list li { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 0 0 18px 6px; font-size: 13.5px; color: #3d5254; overflow-wrap: anywhere; }
    .hp-list li::before { content: ''; position: absolute; left: -29px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: var(--zt-mid2, #2a8a8c);
      box-shadow: 0 0 0 3px #fff; }
    .hp-list li.is-good::before { background: #2e9e57; }
    .hp-list li.is-bad::before { background: #c0392b; }
    .hp-list strong { color: var(--zt-ink, #173f44); font-size: 14.5px; }
    .hp-list small { color: #5f6f70; font-size: 12.5px; }
    .hp-list li.hp-none::before { display: none; }
    .hp-none { color: #5f6f70; }
    .hp-note { margin: 4px 0 0; font-size: 12.5px; color: #5f6f70; }
    .hp-foot { display: flex; justify-content: space-between; gap: 12px; padding: 14px 24px; border-top: 1px solid #e6eeee; }
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
