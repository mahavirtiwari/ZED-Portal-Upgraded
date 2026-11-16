import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface SamePanUnit {
  /** Masked. */
  zedId: string;
  unitName: string | null;
  address: string;
}

export interface SamePanResponse {
  /** In full (for tracing). */
  pan: string | null;
  this: SamePanUnit | null;
  others: SamePanUnit[];
}

/**
 * 2026-11-17 (the user, approved): the other ZED units registered with the unit's PAN, for tracing repeat registrations,
 * before the site exterior photos of the assessment pages and on the unit's profile. A warning strip with "View units",
 * and a pop-up that opens by itself the first time a unit's page is opened in the browser session: the ZED IDs masked,
 * the unit names and addresses in full. Nothing when the PAN has no other unit (or the user may not see the unit).
 */
@Component({
  selector: 'zed-same-pan',
  template: `
    @if (data(); as d) {
      @if (d.others.length) {
        <div class="sp-strip" role="status" data-same-pan>
          <span>⚠ Same PAN: {{ d.others.length === 1 ? '1 other ZED unit is' : d.others.length + ' other ZED units are' }} registered with PAN {{ d.pan }}.
            Check that this is a different plant.</span>
          <button type="button" class="btn btn-link btn-sm p-0" (click)="open.set(true)">View units</button>
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
                  <p class="small text-muted">For tracing repeat registrations.
                    @if (d.this; as me) { This unit: {{ me.zedId }} · {{ me.unitName }}, {{ me.address }} }</p>
                  <div class="table-responsive">
                    <table class="table table-bordered table-zed mb-0" data-same-pan-list>
                      <thead><tr><th>ZED ID</th><th>Unit name</th><th>Address</th></tr></thead>
                      <tbody>
                        @for (u of d.others; track u.zedId + u.address) {
                          <tr><td class="text-nowrap">{{ u.zedId }}</td><td>{{ u.unitName || '—' }}</td><td>{{ u.address || '—' }}</td></tr>
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
    .sp-strip { display: flex; justify-content: space-between; align-items: center; gap: 10px; border: 1px solid #f0c36d; background: #fff8e6;
      color: #7a5300; border-radius: 8px; padding: 8px 12px; margin: 0 0 10px; font-size: 13.5px; }
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
