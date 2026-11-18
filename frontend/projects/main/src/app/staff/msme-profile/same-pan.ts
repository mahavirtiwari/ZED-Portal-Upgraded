import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** 2026-11-18 (the user: "ZED ID is not required to show"): the unit name and its complete address, no ZED ID. */
export interface SamePanUnit {
  unitName: string | null;
  /** Complete: flat / building, road, village / town, city, district, state and PIN. */
  address: string;
}

export interface SamePanResponse {
  /** In full (never masked). */
  pan: string | null;
  this: SamePanUnit | null;
  others: SamePanUnit[];
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
  template: `
    @if (data(); as d) {
      @if (d.others.length) {
        <div class="sp-strip" role="status" data-same-pan>
          <svg class="sp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17h.01" /></svg>
          <div class="sp-text">
            <b>Same PAN: {{ d.others.length === 1 ? '1 other ZED unit is' : d.others.length + ' other ZED units are' }} registered with PAN {{ d.pan }}</b>
            <span>Check that this is a different plant before you accept the application.</span>
            <ul class="sp-list">
              @for (u of d.others; track $index) {
                <li><b>{{ u.unitName || '—' }}</b><span>{{ u.address || '—' }}</span></li>
              }
            </ul>
          </div>
          <button type="button" class="btn btn-link btn-sm p-0 sp-view" (click)="open.set(true)">View units</button>
        </div>
        @if (open()) {
          <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="same-pan-title" (click)="open.set(false)">
            <div class="modal-dialog modal-lg modal-popup" (click)="$event.stopPropagation()">
              <div class="modal-content">
                <div class="modal-header">
                  <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                    <h3 class="registration-title m-0" id="same-pan-title">Other ZED units with the same PAN</h3>
                    <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="open.set(false)"><img src="Images/svgicons/close.svg" alt="" /></button>
                  </div>
                </div>
                <div class="modal-body">
                  <p class="sp-intro">For tracing repeat registrations (PAN {{ d.pan }}).
                    @if (d.this; as me) { This unit: {{ me.unitName }}, {{ me.address }} }</p>
                  <div class="table-responsive">
                    <table class="table table-bordered table-zed mb-0" data-same-pan-list>
                      <thead><tr><th>Unit name</th><th>Complete address</th></tr></thead>
                      <tbody>
                        @for (u of d.others; track $index) {
                          <tr><td>{{ u.unitName || '—' }}</td><td class="sp-addr">{{ u.address || '—' }}</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
                <div class="modal-footer"><button type="button" class="btn btn-default" (click)="open.set(false)">Close</button></div>
              </div>
            </div>
          </div>
          <div class="modal-backdrop show"></div>
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
  private readonly http = inject(HttpClient);

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
      const d = await firstValueFrom(this.http.get<SamePanResponse>(`/api/staff/msme-profile/${encodeURIComponent(zedId)}/same-pan`));
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
