import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, HostListener, ElementRef, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface MsmeNotification {
  at: string;
  text: string;
  level: string | null;
  module: 'Certification' | 'Handholding' | 'Surveillance' | string;
}

export interface NotificationsResponse {
  unread: number;
  items: MsmeNotification[];
}

export const NOTIFICATIONS_API = '/api/msme/notifications';

/**
 * 2026-11-17 (the user: "Notification bell: yes, build it"): the bell of the applicant's header. The unit's history lines
 * (payment received, documents submitted, desktop verification, NCs, certified, handholding, surveillance), newest
 * first; the count is of the lines since the bell was last opened. Opening it marks them read.
 */
@Component({
  selector: 'zed-notification-bell',
  imports: [DatePipe],
  host: { class: 'nb' },
  template: `
    <button type="button" class="nb-btn" [attr.aria-expanded]="open()" aria-haspopup="true"
            [attr.aria-label]="unread() ? 'Notifications, ' + unread() + ' unread' : 'Notifications'" (click)="toggle($event)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
      @if (unread()) { <span class="nb-count" data-unread>{{ unread() > 9 ? '9+' : unread() }}</span> }
    </button>
    @if (open()) {
      <div class="nb-panel" role="dialog" aria-label="Notifications">
        <div class="nb-head">Notifications</div>
        @if (items() === null) {
          <p class="nb-empty">Loading…</p>
        } @else if (!items()!.length) {
          <p class="nb-empty" data-no-notifications>No notifications yet.</p>
        } @else {
          <ul class="nb-list">
            @for (n of items(); track $index) {
              <li [class.nb-new]="$index < seenUnread()">
                <span class="nb-text">{{ n.text }}</span>
                <span class="nb-meta">{{ n.at | date: 'd MMM y, h:mm a' }}{{ tags(n) }}</span>
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; align-items: center; }
    .nb-btn { position: relative; border: 0; background: transparent; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; }
    .nb-btn:hover, .nb-btn:focus-visible { background: rgb(255 255 255 / 10%); }
    .nb-btn svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .nb-count { position: absolute; top: 4px; right: 3px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: #e5484d;
      color: #fff; font-size: 10.5px; font-weight: 800; line-height: 17px; text-align: center; }
    .nb-panel { position: absolute; top: calc(100% + 8px); right: -8px; z-index: 1050; width: min(360px, 92vw); max-height: 70vh; overflow: auto;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 10px; box-shadow: 0 12px 32px rgb(16 61 64 / 18%); color: #24393b; text-align: left; }
    .nb-head { padding: 12px 14px; font-weight: 800; font-size: 14.5px; border-bottom: 1px solid #edf2f2; }
    .nb-empty { margin: 0; padding: 16px 14px; color: #5f6f70; font-size: 13.5px; }
    .nb-list { list-style: none; margin: 0; padding: 0; }
    .nb-list li { padding: 10px 14px; border-bottom: 1px solid #f0f4f4; display: flex; flex-direction: column; gap: 2px; }
    .nb-list li:last-child { border-bottom: 0; }
    .nb-new { background: #f1f8f7; border-left: 3px solid var(--zt-mid2, #2a8a8c); }
    .nb-text { font-size: 13.5px; line-height: 1.4; }
    .nb-meta { font-size: 12px; color: #6b7c7d; }
  `,
})
export class NotificationBell {
  private readonly http = inject(HttpClient);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly open = signal(false);
  protected readonly unread = signal(0);
  /** The unread count when the panel was opened (those lines stay marked while it is open). */
  protected readonly seenUnread = signal(0);
  protected readonly items = signal<MsmeNotification[] | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const r = await firstValueFrom(this.http.get<NotificationsResponse>(NOTIFICATIONS_API));
      this.items.set(r.items ?? []);
      this.unread.set(r.unread ?? 0);
    } catch {
      // Optional: no bell count when the notifications cannot be read.
      this.items.set([]);
    }
  }

  /** " · Silver · Handholding": the level, and the module unless it is the certification. */
  protected tags(n: MsmeNotification): string {
    return [n.level, n.module !== 'Certification' ? n.module : null].filter((t) => !!t).map((t) => ` · ${t}`).join('');
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    const opening = !this.open();
    this.open.set(opening);
    if (opening && this.unread()) {
      this.seenUnread.set(this.unread());
      this.unread.set(0);
      this.http.post(`${NOTIFICATIONS_API}/seen`, {}).subscribe({ error: () => undefined });
    }
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
