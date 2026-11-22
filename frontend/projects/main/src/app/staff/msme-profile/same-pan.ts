import { HttpClient } from '@angular/common/http';
import { Component, Injectable, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { SideDrawer } from '../side-drawer';

/** 2026-11-18 (the user: "ZED ID is not required to show"): the unit name and its complete address, no ZED ID. */
export interface SamePanUnit {
  unitName: string | null;
  /** Complete: flat / building, road, village / town, city, district, state and PIN. */
  address: string;
  /** 2026-11-22: the Master Admin and its operation admins only (absent for agencies and assessors). */
  zedId?: string | null;
  /** As zedId: the unit's current level and status. */
  status?: string | null;
  /** As zedId: the same Udyam registration and plant address as the unit (the old portal's duplicate). */
  duplicate?: boolean | null;
}

export interface SamePanResponse {
  /** In full (never masked). */
  pan: string | null;
  this: SamePanUnit | null;
  others: SamePanUnit[];
}

/**
 * 2026-11-22: the units of a PAN, asked once for a page (the "Same PAN" strip and the summary's count share the answer; kept for a
 * minute, so a list's counts opened one after the other do not ask twice).
 */
@Injectable({ providedIn: 'root' })
export class SamePanStore {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, { at: number; answer: Promise<SamePanResponse> }>();

  get(zedId: string): Promise<SamePanResponse> {
    const key = zedId.trim().toUpperCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.answer;
    const answer = firstValueFrom(this.http.get<SamePanResponse>(`/api/staff/msme-profile/${encodeURIComponent(zedId)}/same-pan`));
    this.cache.set(key, { at: Date.now(), answer });
    answer.catch(() => this.cache.delete(key));
    return answer;
  }
}

/**
 * 2026-11-22 (the product owner: "show the number of units registered in the same PAN with a clickable ... visible as pop-up ... in
 * case of master admin and operation admin in pop-up also show ZED ID, current status and which one is duplicate. While in assessor
 * and assessment agency do not show ZED ID and current status"; then: "side panel as you are showing for history"): the units of
 * the PAN in the History-style side panel. What each login sees is the server's (the ZED ID, status and duplicate come only for
 * the Master Admin and its operation admins); this unit first, then the others, a duplicate marked.
 */
@Component({
  selector: 'zed-same-pan-drawer',
  imports: [TextPipe, SideDrawer],
  template: `
    <zed-side-drawer id="same-pan-drawer" [title]="'Units with the same PAN' | t: 'staff.samePan.drawer.title'" [subtitle]="subtitle()" (closed)="closed.emit()">
      @if (!data()) {
        <p class="spd-note" role="status">{{ 'Loading…' | t: 'staff.samePan.drawer.loading' }}</p>
      } @else {
        @if (duplicates() > 0) {
          <p class="spd-dup-note" role="status">{{ duplicates() === 1 ? ('1 unit has the same Udyam registration and plant address: a duplicate.' | t: 'staff.samePan.drawer.duplicateOne')
            : ('{count} units have the same Udyam registration and plant address: duplicates.' | t: 'staff.samePan.drawer.duplicateMany' : { count: duplicates() }) }}</p>
        }
        <ol class="spd-list" data-same-pan-list>
          @if (data()!.this; as me) {
            <li class="spd-this">
              <div class="spd-top"><b>{{ me.unitName || '—' }}</b><span class="spd-tag spd-tag-this">{{ 'This unit' | t: 'staff.samePan.drawer.thisUnit' }}</span></div>
              @if (full()) { <div class="spd-meta"><span>{{ me.zedId }}</span>@if (me.status) { <span>{{ me.status }}</span> }</div> }
              <span class="spd-addr">{{ me.address || '—' }}</span>
            </li>
          }
          @for (u of data()!.others; track $index) {
            <li [class.spd-dup]="u.duplicate" [attr.data-duplicate]="u.duplicate ? 'yes' : null">
              <div class="spd-top"><b>{{ u.unitName || '—' }}</b>
                @if (u.duplicate) { <span class="spd-tag spd-tag-dup">{{ 'Duplicate' | t: 'staff.samePan.drawer.duplicate' }}</span> }</div>
              @if (full()) { <div class="spd-meta" data-same-pan-meta><span>{{ u.zedId }}</span>@if (u.status) { <span>{{ u.status }}</span> }</div> }
              <span class="spd-addr">{{ u.address || '—' }}</span>
            </li>
          } @empty {
            <li class="spd-note">{{ 'No other ZED unit is registered with this PAN.' | t: 'staff.samePan.drawer.none' }}</li>
          }
        </ol>
        <p class="spd-note">{{ 'For tracing repeat registrations: check that each is a different plant before you accept the application.' | t: 'staff.samePan.drawer.note' }}</p>
      }
      <div drawer-foot class="spd-foot">
        <span></span>
        <button type="button" class="btn btn-default" (click)="closed.emit()">{{ 'Close' | t: 'staff.samePan.drawer.close' }}</button>
      </div>
    </zed-side-drawer>
  `,
  styles: `
    .spd-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .spd-list li { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid #dde7e8; border-radius: 10px; font-size: 12.5px; color: #3d5559; }
    .spd-list li.spd-this { background: #f4f9f9; }
    .spd-list li.spd-dup { border-color: #e7b3ad; background: #fdf3f2; }
    .spd-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .spd-top b { font-size: 14px; color: #17373b; }
    .spd-tag { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 1px 7px; }
    .spd-tag-this { background: #e2eff0; color: #24666b; }
    .spd-tag-dup { background: #b0362b; color: #fff; }
    .spd-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; font-weight: 600; color: #24666b; }
    .spd-addr { overflow-wrap: break-word; }
    .spd-note { margin: 12px 0 0; font-size: 12px; color: #6f8487; border: 0; padding: 0; }
    .spd-dup-note { margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; background: #fdf3f2; color: #a32d2d; font-size: 12.5px; font-weight: 600; }
    .spd-foot { display: contents; }
    .spd-foot .btn { min-height: 40px; min-width: 100px; border-radius: 9px; font-weight: 700; background: #e7eeee; border-color: #e7eeee; color: #17373b; }
  `,
})
export class SamePanDrawer {
  /** null while loading. */
  readonly data = input<SamePanResponse | null>(null);
  readonly closed = output<void>();
  /** The server sent the ZED IDs (the Master Admin and its operation admins). */
  protected readonly full = computed(() => {
    const d = this.data();
    return !!d && [d.this, ...d.others].some((u) => !!u?.zedId);
  });
  protected readonly duplicates = computed(() => (this.data()?.others ?? []).filter((u) => u.duplicate).length);
  protected readonly subtitle = computed(() => (this.data()?.pan ? t('staff.samePan.drawer.subtitle', 'PAN {pan}', { pan: this.data()!.pan! }) : ''));
}

/**
 * 2026-11-17 (the user, approved): the other ZED units registered with the unit's PAN, for tracing repeat registrations,
 * before the site exterior photos of the assessment pages and on the unit's profile. A warning strip with "View units",
 * and a pop-up that opens by itself the first time a unit's page is opened in the browser session: the ZED IDs masked,
 * the unit names and addresses in full. Nothing when the PAN has no other unit (or the user may not see the unit).
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files', staff-14d / staff-15): the strip is the designs' amber card: the
 * PAN masked ("AB•••••34F"), "Check that this is a different plant before you accept the application.", and the other units
 * listed inline (masked ZED ID, name and address); the pop-up's intro line without the yellow background a global
 * <code>.small.text-muted</code> style gave it (its own class now), with the full PAN for tracing.
 * 2026-11-18 (the user): the PAN in full on the strip too (never masked); no ZED ID anywhere ("ZED ID is not required to
 * show"); each unit's name and its complete address ("Please show the complete address"), the address wrapping at word
 * breaks, never cut.
 */
@Component({
  selector: 'zed-same-pan',
  imports: [TextPipe, SamePanDrawer],
  template: `
    @if (data(); as d) {
      @if (d.others.length) {
        <div class="sp-strip" role="status" data-same-pan>
          <svg class="sp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17h.01" /></svg>
          <div class="sp-text">
            <b>{{ d.others.length === 1 ? ('Same PAN: 1 other ZED unit is registered with PAN {pan}' | t: 'staff.samePan.strip.one' : { pan: d.pan }) : ('Same PAN: {count} other ZED units are registered with PAN {pan}' | t: 'staff.samePan.strip.many' : { count: d.others.length, pan: d.pan }) }}</b>
            <span>{{ 'Check that this is a different plant before you accept the application.' | t: 'staff.samePan.strip.note' }}</span>
            <ul class="sp-list">
              @for (u of d.others; track $index) {
                <li><b>{{ u.unitName || '—' }}</b><span>{{ u.address || '—' }}</span></li>
              }
            </ul>
          </div>
          <button type="button" class="btn btn-link btn-sm p-0 sp-view" (click)="open.set(true)">{{ 'View units' | t: 'staff.samePan.viewButton' }}</button>
        </div>
        @if (open()) {
          <!-- 2026-11-22 (the product owner): the History-style side panel instead of the pop-up. -->
          <zed-same-pan-drawer [data]="d" (closed)="open.set(false)" />
        }
      }
    }
  `,
  styles: `
    .sp-strip { display: flex; align-items: flex-start; gap: 12px; border: 1px solid #ecd98a; background: #fdf2dc; color: #9a5f06; border-radius: 14px;
      padding: 14px 18px; margin: 0 0 16px; font-size: 12.5px; }
    .sp-ico { flex: none; width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; margin-top: 1px; }
    .sp-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .sp-text > b { font-size: 13.5px; }
    .sp-text > span { color: #3d5559; }
    .sp-list { list-style: none; margin: 8px 0 0; padding: 0; }
    .sp-list li { display: flex; flex-wrap: wrap; gap: 4px 20px; padding: 8px 14px; background: #fff; border: 1px solid #ecd98a; border-radius: 8px; color: #3d5559; }
    .sp-list li + li { margin-top: 6px; }
    .sp-list b { color: #17373b; }
    .sp-list span, .sp-addr { overflow-wrap: break-word; word-break: normal; }
    .sp-view { font-weight: 700; color: #24666b; white-space: nowrap; }
    .sp-intro { margin: 0 0 10px; font-size: 13px; color: #6f8487; background: none; }
  `,
})
export class SamePanUnits {
  private readonly store = inject(SamePanStore);

  readonly zedId = input.required<string>();
  protected readonly data = signal<SamePanResponse | null>(null);
  protected readonly open = signal(false);

  constructor() {
    effect(() => {
      const zedId = this.zedId();
      untracked(() => void this.load(zedId));
    });
  }

  private async load(zedId: string): Promise<void> {
    if (!zedId) return;
    try {
      const d = await this.store.get(zedId);
      this.data.set(d);
      // The first time in this browser session for the unit: the list opens by itself.
      if (d.others.length && !this.seen(zedId)) this.open.set(true);
    } catch {
      // Optional: not visible to this user, or not served on this portal.
      this.data.set(null);
    }
  }

  private seen(zedId: string): boolean {
    const key = 'zed.samePan.' + zedId.toUpperCase();
    try {
      if (sessionStorage.getItem(key)) return true;
      sessionStorage.setItem(key, '1');
    } catch {
      // Storage blocked: show it each time.
    }
    return false;
  }
}

/**
 * 2026-11-22: the number of the other units of the unit's PAN as a link that opens the side panel (assessment summaries, Monitoring).
 * Given <code>count</code> (a list's), the units are asked only when it is opened; without it, on show.
 */
@Component({
  selector: 'zed-same-pan-count',
  imports: [TextPipe, SamePanDrawer],
  template: `
    @if (shownCount(); as n) {
      <button type="button" class="spc" [class.spc-many]="n > 0" data-same-pan-count (click)="openIt()"
        [attr.aria-label]="'Units with the same PAN: {count}' | t: 'staff.samePan.count.aria' : { count: n }">{{ n }}</button>
    } @else {
      <span class="spc-zero" data-same-pan-count>{{ shownCount() === 0 ? '0' : '—' }}</span>
    }
    @if (open()) { <zed-same-pan-drawer [data]="data()" (closed)="open.set(false)" /> }
  `,
  styles: `
    :host { display: inline-flex; }
    .spc { border: 0; background: none; padding: 0; font: inherit; font-weight: 700; color: #24666b; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .spc.spc-many { color: #b0362b; }
    .spc-zero { color: #6f8487; font-weight: 700; }
  `,
})
export class SamePanCount {
  private readonly store = inject(SamePanStore);
  readonly zedId = input.required<string>();
  /** The list's count (Monitoring); null: asked from the server. */
  readonly count = input<number | null>(null);
  protected readonly data = signal<SamePanResponse | null>(null);
  protected readonly open = signal(false);
  private readonly loaded = signal<number | null>(null);
  protected readonly shownCount = computed(() => this.count() ?? this.loaded());

  constructor() {
    effect(() => {
      const z = this.zedId();
      if (this.count() === null && z) untracked(() => void this.load(z));
    });
  }

  protected openIt(): void {
    this.open.set(true);
    if (!this.data()) void this.load(this.zedId());
  }

  private async load(zedId: string): Promise<void> {
    try {
      const d = await this.store.get(zedId);
      this.data.set(d);
      this.loaded.set(d.others.length);
    } catch {
      this.loaded.set(null);
      this.open.set(false);
    }
  }
}
