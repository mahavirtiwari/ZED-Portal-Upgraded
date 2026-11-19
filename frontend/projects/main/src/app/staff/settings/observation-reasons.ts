import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ALL_PORTALS, PortalSwitchComponent } from '../admin-portal';
import { itemId } from './submission-checklists';
import { ConfirmService } from '../confirm-dialog';

export type Severity = 'Minor' | 'Major' | 'Critical';

/** A reason of a quality observation (Zed.Portal.Features.Staff.Quality.ObservationReason). */
export interface ObservationReasonDef {
  id: string;
  text: string;
  severity: Severity;
  active: boolean;
}

export interface ObservationReasonsResponse {
  reasons: ObservationReasonDef[];
  severities: Severity[];
  /** Observations raised with each wording. */
  used: Record<string, number>;
  customised: boolean;
  /** The Consultancy portal: handholding reasons. */
  handholding: boolean;
}

export const REASON_LIMITS = { reasons: 40, text: 150 } as const;

/** What each severity does (fixed; QualityObservations.Points / Blocking). */
export const SEVERITY_NOTES: Record<Severity, string> = {
  Minor: '1 point',
  Major: '3 points, holds the final submit',
  Critical: '5 points, holds the final submit',
};

interface Editing {
  reason: ObservationReasonDef | null;
  text: string;
  severity: Severity;
  active: boolean;
}

/**
 * Admin → Observation reasons (2026-11-17, approved): the reasons the operation admins pick for a quality observation, each with
 * the severity it carries (the operation admin does not choose the severity). Per portal (the portal switch); the Consultancy
 * portal's are the handholding reasons. Laid out as Submission checklists. The observations already raised keep the wording and
 * severity they were raised with.
 */
@Component({
  selector: 'zed-staff-observation-reasons',
  imports: [FormsModule, PortalSwitchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Observation reasons</h3>
        <p class="page-sub">The reasons the operation admins pick for a quality observation{{ data()?.handholding ? ' on a handholding milestone' : '' }}, each with its severity.</p>
      </div>
      @if (data(); as d) {
        <div class="page-actions">
          <button type="button" class="btn btn-default" [disabled]="!d.customised || busy()" (click)="resetAll()">Reset to standard reasons</button>
          <button type="button" class="btn btn-primary" [disabled]="d.reasons.length >= limits.reasons || busy()" (click)="add()">Add reason</button>
        </div>
      }
    </div>
    <zed-portal-switch [portals]="portals" />
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }

    @if (data(); as d) {
      <div class="sev-legend">
        @for (s of d.severities; track s) {
          <span><span [class]="'sev sev-' + s.toLowerCase()">{{ s }}</span> {{ note(s) }}</span>
        }
      </div>
      <div class="table-responsive">
        <table class="table table-zed reasons-table">
          <colgroup>
            <col style="width: 56px" />
            <col />
            <col style="width: 120px" />
            <col style="width: 80px" />
            <col class="col-actions" style="width: 268px" />
          </colgroup>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th>Reason</th>
              <th>Severity</th>
              <th class="text-center">Used</th>
              <th class="text-end">Action</th>
            </tr>
          </thead>
          <tbody>
            @for (r of d.reasons; track r.id; let n = $index, last = $last) {
              <tr [class.is-off]="!r.active" [attr.data-id]="r.id">
                <td class="text-center"><span class="order-no">{{ n + 1 }}</span></td>
                <td><span class="reason-text">{{ r.text }}</span> @if (!r.active) { <span class="status-badge is-inactive">Off</span> }</td>
                <td><span [class]="'sev sev-' + r.severity.toLowerCase()">{{ r.severity }}</span></td>
                <td class="text-center">{{ used(r) }}</td>
                <td>
                  <div class="st-actions">
                    <button type="button" class="st-icon" title="Move up" aria-label="Move up" [disabled]="n === 0 || busy()" (click)="move(n, -1)">↑</button>
                    <button type="button" class="st-icon" title="Move down" aria-label="Move down" [disabled]="last || busy()" (click)="move(n, 1)">↓</button>
                    <label class="st-switch" [class.off]="!r.active" [title]="r.active ? 'Switch this reason off' : 'Switch this reason on'">
                      <input type="checkbox" role="switch" [checked]="r.active" [disabled]="busy()" [attr.aria-label]="(r.active ? 'Switch off ' : 'Switch on ') + r.text"
                        (click)="$event.preventDefault(); toggle(n)" />
                      <span class="st-track" aria-hidden="true"></span>{{ r.active ? 'On' : 'Off' }}
                    </label>
                    <button type="button" class="st-edit" [disabled]="busy()" (click)="edit(r)">Edit</button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="sync-note">
        <span class="info-dot" aria-hidden="true">i</span>
        @if (!d.customised) { <span class="standard-note">Standard reasons (not changed yet).</span> }
        A reason already used can be renamed or switched off; the observations raised keep the wording and severity they were raised with.
      </p>
    } @else if (!busy()) {
      <div class="no-data">The observation reasons could not be loaded</div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="reasonTitle">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-start gap-3">
                <h3 class="registration-title m-0" id="reasonTitle">{{ e.reason ? 'Edit reason' : 'Add reason' }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              @let p = check(e);
              <label class="form-label" for="reasonText">Reason<span class="req">*</span></label>
              <input type="text" class="form-control" id="reasonText" [maxlength]="limits.text" placeholder="e.g. Evidence not checked properly" [class.is-invalid]="p" [(ngModel)]="e.text" />
              @if (p) { <small class="invalid">{{ p }}</small> }
              <span class="form-label d-block mt-3">Severity<span class="req">*</span></span>
              <div class="seg" role="group" aria-label="Severity">
                @for (s of data()?.severities ?? []; track s) {
                  <button type="button" [class.active]="e.severity === s" [attr.aria-pressed]="e.severity === s" [attr.data-severity]="s"
                    (click)="editing.set({ ...e, severity: s })">{{ s }}</button>
                }
              </div>
              <small class="text-muted d-block mt-1">{{ note(e.severity) }}</small>
              <div class="form-check mt-3">
                <input class="form-check-input" type="checkbox" id="reasonActive" [(ngModel)]="e.active" />
                <label class="form-check-label" for="reasonActive">In use</label>
              </div>
              @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="Cancel" (click)="editing.set(null)" />
              <input type="button" class="btn btn-primary" value="Save" [disabled]="busy()" (click)="save(e)" />
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .sev-legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: #5f6f70; margin: 0 0 10px; }
    .sev { display: inline-block; font-size: 12px; padding: 2px 10px; border-radius: 10px; background: #eef2f2; color: #3d4f50; border: 1px solid #d9e2e2; }
    .sev-major { background: #fdf3e1; color: #8a5a00; border-color: #f2d9a6; }
    .sev-critical { background: #fdecec; color: #a32d2d; border-color: #f2c4c4; }
    .reasons-table { table-layout: fixed; width: 100%; min-width: 760px; margin-bottom: 0; }
    .reasons-table td { overflow-wrap: anywhere; vertical-align: middle; }
    .reasons-table tr.is-off td { color: #8a9899; }
    .reason-text { font-size: 14px; color: #232527; }
    .is-off .reason-text { color: #8a9899; }
    .order-no { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 14px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 13px; }
    .sync-note { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: flex-start; color: #5f6f70; font-size: 13px; margin: 10px 0 0; }
    .standard-note { font-weight: 600; color: #23474a; }
    .info-dot { flex: 0 0 18px; height: 18px; border-radius: 9px; background: #45a5ad; color: #fff; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; font-style: italic; font-family: Georgia, serif; }
    /* 2026-11-19 (admin audit: "Edi/t" and "O/n" at 1536px): the action column is wide enough and its buttons never wrap. */
    .st-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: nowrap; white-space: nowrap; overflow-wrap: normal; }
    .st-actions > * { flex: none; }
    .st-icon { width: 30px; height: 30px; display: inline-grid; place-items: center; border: 1px solid #cbd9da; border-radius: 6px; background: #fff;
      color: #23474a; font-weight: 700; padding: 0; }
    .st-icon:disabled { opacity: .35; cursor: default; }
    .st-edit { border: 1px solid #9cc9cd; background: #fff; color: var(--zt-dark, #23656b); border-radius: 6px; padding: 4px 14px; font-weight: 600; font-size: 13px; }
    .st-switch { display: inline-flex; align-items: center; gap: 5px; margin: 0 4px; font-size: 12.5px; font-weight: 600; color: #1e7a3c; cursor: pointer; text-transform: none; }
    .st-switch.off { color: #8a9899; }
    .st-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .st-track { position: relative; width: 30px; height: 16px; border-radius: 9px; background: #45a5ad; flex: none; }
    .st-track::after { content: ''; position: absolute; top: 2px; left: 16px; width: 12px; height: 12px; border-radius: 50%; background: #fff; }
    .st-switch.off .st-track { background: #c3cdce; }
    .st-switch.off .st-track::after { left: 2px; }
    .st-switch input:focus-visible + .st-track { outline: 2px solid var(--zt-dark, #23656b); outline-offset: 2px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: var(--zt-soft, #d9eef0); color: var(--zt-ink, #174a4e); font-size: 13px; font-weight: 600; padding: 6px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button.active { background: var(--zt-dark, #23656b); color: #fff; }
    .invalid { display: block; color: #a8303a; font-size: 12.5px; margin-top: 3px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class ObservationReasonsPage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private static readonly url = '/api/staff/settings/observation-reasons';

  protected readonly limits = REASON_LIMITS;
  protected readonly portals = ALL_PORTALS;
  protected readonly data = signal<ObservationReasonsResponse | null>(null);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');
  private readonly tried = signal(false);

  /** Observations per wording, matched ignoring case. */
  private readonly usedByText = computed(() => {
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(this.data()?.used ?? {})) m.set(k.trim().toLowerCase(), (m.get(k.trim().toLowerCase()) ?? 0) + v);
    return m;
  });

  constructor() {
    void this.load();
  }

  protected note(s: Severity): string {
    return SEVERITY_NOTES[s] ?? '';
  }

  protected used(r: ObservationReasonDef): number {
    return this.usedByText().get(r.text.trim().toLowerCase()) ?? 0;
  }

  protected add(): void {
    this.modalError.set('');
    this.tried.set(false);
    this.editing.set({ reason: null, text: '', severity: 'Minor', active: true });
  }

  protected edit(r: ObservationReasonDef): void {
    this.modalError.set('');
    this.tried.set(false);
    this.editing.set({ reason: r, text: r.text, severity: r.severity, active: r.active });
  }

  /** The server's rules (ObservationReasons.Problem) for the reason's wording; null when fine. */
  protected check(e: Editing): string | null {
    const text = e.text.trim();
    if (!text) return this.tried() ? 'Enter the reason.' : null;
    if (text.length > REASON_LIMITS.text) return `At most ${REASON_LIMITS.text} characters.`;
    const others = (this.data()?.reasons ?? []).filter((r) => r.id !== e.reason?.id);
    if (others.some((r) => r.text.trim().toLowerCase() === text.toLowerCase())) return 'Another reason has this wording.';
    return null;
  }

  protected async save(e: Editing): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.tried.set(true);
    if (this.check(e)) return;
    const reason: ObservationReasonDef = {
      id: e.reason?.id ?? itemId(e.text.trim(), d.reasons.map((r) => r.id)),
      text: e.text.trim(),
      severity: e.severity,
      active: e.active,
    };
    const reasons = e.reason ? d.reasons.map((r) => (r.id === e.reason!.id ? reason : r)) : [...d.reasons, reason];
    this.busy.set(true);
    this.modalError.set('');
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(ObservationReasonsPage.url, { reasons }));
      this.editing.set(null);
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(index: number): Promise<void> {
    const reasons = (this.data()?.reasons ?? []).map((x) => ({ ...x }));
    const r = reasons[index];
    if (!r) return Promise.resolve();
    if (r.active && !(await this.confirms.ask({
      title: 'Switch the Reason Off?', message: `"${r.text}" is no longer offered for new observations.`, confirmLabel: 'Switch Off', danger: true,
    }))) return;
    r.active = !r.active;
    return this.change(() => this.http.put<MessageResponse>(ObservationReasonsPage.url, { reasons }));
  }

  protected move(index: number, by: -1 | 1): Promise<void> {
    const reasons = [...(this.data()?.reasons ?? [])];
    const target = index + by;
    if (target < 0 || target >= reasons.length) return Promise.resolve();
    [reasons[index], reasons[target]] = [reasons[target], reasons[index]];
    return this.change(() => this.http.put<MessageResponse>(ObservationReasonsPage.url, { reasons }));
  }

  protected async resetAll(): Promise<void> {
    if (!(await this.confirms.ask({
      title: 'Reset to the Standard Reasons?', message: 'The reasons added or changed here are removed.', confirmLabel: 'Reset', danger: true,
    }))) return;
    return this.change(() => this.http.delete<MessageResponse>(ObservationReasonsPage.url));
  }

  private async change(request: () => Observable<MessageResponse>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(request());
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      this.data.set(await firstValueFrom(this.http.get<ObservationReasonsResponse>(ObservationReasonsPage.url)));
    } catch (err) {
      this.data.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
