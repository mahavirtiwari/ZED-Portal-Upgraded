import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, HostListener, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { firstValueFrom, filter } from 'rxjs';

/** One kind of work waiting for the login (api/staff/attention, AttentionController). */
export interface AttentionItem {
  /** Stable name: allot, reallot, nc-overdue, quality-open, da-allot, sa-allot, review, nc-replies, quality-agency, da-accept, da-assess,
   *  nc-review, site-due, site-review, milestone-review. */
  key: string;
  label: string;
  count: number;
  /** The page that lists it, with its query parameters (e.g. the monitoring tab). */
  link: string;
  query: Record<string, string> | null;
  tone: 'warn' | 'bad' | 'info' | 'good';
  /** A hint for the tile's icon. */
  icon: 'people' | 'clock' | 'chat' | 'refresh' | 'check' | 'calendar' | string;
}

export interface AttentionResponse {
  total: number;
  items: AttentionItem[];
}

export const ATTENTION_API = '/api/staff/attention';

/** The roles whose work the server counts (Master Admin, agency / consultant organisation, assessor / consultant). */
export const ATTENTION_ROLES: readonly number[] = [7, 2, 3];

/**
 * 2026-11-17 (approved staff redesign): the work waiting for the signed-in login, shared by the header's bell and the
 * dashboard's "Needs your attention" row. <code>data()</code> is null until loaded; <code>load()</code> asks again when the
 * last answer is older than 30 seconds (the server keeps it as long), <code>refresh()</code> at once (after a change).
 */
@Injectable({ providedIn: 'root' })
export class AttentionService {
  private readonly http = inject(HttpClient);
  readonly data = signal<AttentionResponse | null>(null);
  private loadedAt = 0;
  private pending: Promise<AttentionResponse | null> | null = null;

  load(): Promise<AttentionResponse | null> {
    if (this.data() && Date.now() - this.loadedAt < 30_000) return Promise.resolve(this.data());
    return this.fetch(false);
  }

  refresh(): Promise<AttentionResponse | null> {
    return this.fetch(true);
  }

  private fetch(fresh: boolean): Promise<AttentionResponse | null> {
    if (this.pending && !fresh) return this.pending;
    const call = firstValueFrom(this.http.get<AttentionResponse>(ATTENTION_API, fresh ? { params: { fresh: 'true' } } : {}))
      .then((r) => {
        this.data.set({ total: r.total ?? 0, items: r.items ?? [] });
        this.loadedAt = Date.now();
        return this.data();
      })
      // Optional: without an answer the bell shows no count.
      .catch(() => this.data())
      .finally(() => (this.pending = null));
    this.pending = call;
    return call;
  }
}

/**
 * The header's bell: the badge is the number of items waiting, the panel lists each count with a link to its page (counts of
 * 0 are greyed). Refreshed when the page changes (at most every 30 seconds).
 */
@Component({
  selector: 'zed-attention-bell',
  imports: [RouterLink],
  host: { class: 'ab' },
  template: `
    @let d = service.data();
    <button type="button" class="ab-btn" aria-haspopup="true" [attr.aria-expanded]="open()"
            [attr.aria-label]="d?.total ? 'Needs your attention, ' + d!.total + ' waiting' : 'Needs your attention'" (click)="toggle($event)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      @if (d?.total) { <span class="ab-count" data-total>{{ d!.total > 99 ? '99+' : d!.total }}</span> }
    </button>
    @if (open()) {
      <div class="ab-panel" role="dialog" aria-label="Needs your attention">
        <div class="ab-head">Needs your attention</div>
        @if (d === null) {
          <p class="ab-empty">Loading…</p>
        } @else if (!d.total) {
          <p class="ab-empty" data-nothing>Nothing is waiting for you.</p>
        }
        @if (d?.items?.length) {
          <ul class="ab-list">
            @for (i of d!.items; track i.key) {
              <li>
                <a [routerLink]="i.link" [queryParams]="i.query" [class.ab-zero]="!i.count" (click)="open.set(false)">
                  <b [class]="'ab-n is-' + i.tone">{{ i.count }}</b>&ngsp;<span>{{ i.label }}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                </a>
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; align-items: center; }
    .ab-btn { position: relative; width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent; display: grid; place-items: center; color: #fff; }
    .ab-btn:hover, .ab-btn:focus-visible { background: rgba(255, 255, 255, 0.12); outline: none; }
    .ab-btn svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .ab-count { position: absolute; top: 3px; right: 1px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: #e5484d;
      color: #fff; font-size: 10.5px; font-weight: 800; line-height: 18px; text-align: center; }
    .ab-panel { position: absolute; top: calc(100% + 8px); right: -8px; z-index: 1050; width: min(340px, 92vw); max-height: 70vh; overflow: auto;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 10px; box-shadow: 0 12px 32px rgba(16, 61, 64, 0.18); color: #24393b; text-align: left; }
    .ab-head { padding: 12px 14px; font-size: 14.5px; font-weight: 800; border-bottom: 1px solid #edf2f2; }
    .ab-empty { margin: 0; padding: 14px; font-size: 13.5px; color: #5f6f70; }
    .ab-list { list-style: none; margin: 0; padding: 6px; }
    .ab-list a { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 8px; color: #24393b; text-decoration: none; font-size: 13.5px; }
    .ab-list a:hover, .ab-list a:focus-visible { background: #eef6f5; outline: none; }
    .ab-list a span { flex: 1; }
    .ab-list a svg { width: 16px; height: 16px; fill: none; stroke: #8a9899; stroke-width: 2; }
    .ab-n { min-width: 34px; padding: 3px 6px; border-radius: 8px; text-align: center; font-size: 13px; font-weight: 800; background: #eef6f5; color: var(--zt-ink, #173f44); }
    .ab-n.is-warn { background: #fdf1dc; color: #a05f00; }
    .ab-n.is-bad { background: #fbe4e1; color: #b03a2e; }
    .ab-n.is-good { background: #e3f4e8; color: #1e7a3c; }
    .ab-zero { color: #7a8a8b !important; }
    .ab-zero .ab-n { background: #f1f4f4; color: #7a8a8b; }
  `,
})
export class AttentionBell {
  protected readonly service = inject(AttentionService);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly open = signal(false);

  constructor() {
    void this.service.load();
    inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => void this.service.load());
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((v) => !v);
    if (this.open()) void this.service.load();
  }

  @HostListener('document:click', ['$event'])
  protected outside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.open.set(false);
  }
}
