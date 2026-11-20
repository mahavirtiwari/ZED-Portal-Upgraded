import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe } from '../../content/page-text';
import { ToastService } from '../toast';
import { SchemeTick, SchemeVerificationApi } from './scheme-verification.api';

/**
 * 2026-11-20 (incentive schemes, approved): the schemes an agency (set by the Master Admin) or an assessor (set by its agency, only
 * within the agency's own ticks) verifies: per active scheme "Desktop verification" and "Onsite verification" (onsite: phase 2, the
 * assessor app). Saved on its own (Users.SchemeVerification). Placed on the agency and assessor pages, opened on demand.
 */
@Component({
  selector: 'zed-scheme-ticks-panel',
  imports: [TextPipe],
  template: `
    <section class="zed-card stp" aria-labelledby="stp-h">
      <div class="stp-head">
        <h4 id="stp-h" class="m-0">{{ 'Incentive schemes verified' | t: 'staff.schemeVerification.ticks.title' }}</h4>
        <button type="button" class="btn btn-outline-primary btn-sm" [attr.aria-expanded]="open()" (click)="toggleOpen()">
          {{ open() ? ('Hide' | t: 'staff.schemeVerification.ticks.hide') : ('Show' | t: 'staff.schemeVerification.ticks.show') }}</button>
      </div>
      @if (open()) {
      <p class="sub">{{ kind() === 'agencies'
        ? ('Applications of a scheme go by round robin to the agencies ticked for it (in the unit’s states and sectors).' | t: 'staff.schemeVerification.ticks.agencyHelp')
        : ('The agency can name this assessor for the schemes ticked here (within the agency’s own ticks).' | t: 'staff.schemeVerification.ticks.assessorHelp') }}</p>
      @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
      @if (rows().length) {
        <table class="table stp-table">
          <thead>
            <tr>
              <th>{{ 'Scheme' | t: 'staff.schemeVerification.ticks.scheme' }}</th>
              <th>{{ 'Desktop verification' | t: 'staff.schemeVerification.ticks.desktop' }}</th>
              <th>{{ 'Onsite verification' | t: 'staff.schemeVerification.ticks.onsite' }} <small class="sub">{{ '(phase 2)' | t: 'staff.schemeVerification.ticks.phase2' }}</small></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.code; let i = $index) {
              <tr>
                <td>{{ r.name }} <small class="sub">{{ r.code }}</small></td>
                <td><input type="checkbox" [attr.aria-label]="r.name + ' – desktop'" [checked]="r.desktop" [disabled]="!editable() || (!r.canDesktop && !r.desktop)" (change)="toggle(i, 'desktop', $any($event.target).checked)" /></td>
                <td><input type="checkbox" [attr.aria-label]="r.name + ' – onsite'" [checked]="r.onsite" [disabled]="!editable() || (!r.canOnsite && !r.onsite)" (change)="toggle(i, 'onsite', $any($event.target).checked)" /></td>
              </tr>
            }
          </tbody>
        </table>
        @if (editable()) {
          <div class="text-end"><button type="button" class="btn btn-primary btn-sm" [disabled]="saving() || !dirty()" (click)="save()">{{ 'Save schemes' | t: 'staff.schemeVerification.ticks.save' }}</button></div>
        }
      } @else if (!loading()) {
        <p class="sub m-0">{{ 'No incentive scheme is active.' | t: 'staff.schemeVerification.ticks.none' }}</p>
      }
      }
    </section>
  `,
  styles: `
    .stp { padding: 16px 20px; margin-top: 16px; }
    .stp h4 { font-size: 16px; }
    .stp-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; }
    .stp-table { font-size: 13px; margin-bottom: 8px; }
    .stp-table input { width: 18px; height: 18px; accent-color: #24666b; }
  `,
})
export class SchemeTicksPanel {
  private readonly api = inject(SchemeVerificationApi);
  private readonly toast = inject(ToastService);
  /** 'agencies' (the Master Admin) or 'assessors' (its agency). */
  readonly kind = input.required<'agencies' | 'assessors'>();
  readonly userId = input.required<string>();

  protected readonly rows = signal<SchemeTick[]>([]);
  protected readonly editable = signal(false);
  protected readonly dirty = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  /** Opened on demand (the page itself loads nothing more until then). */
  protected readonly open = signal(false);

  constructor() {
    effect(() => {
      const kind = this.kind();
      const id = this.userId();
      if (untracked(() => this.open())) untracked(() => void this.load(kind, id));
    });
  }

  protected toggleOpen(): void {
    this.open.update((o) => !o);
    if (this.open()) void this.load(this.kind(), this.userId());
  }

  private async load(kind: 'agencies' | 'assessors', id: string): Promise<void> {
    if (!id) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.api.ticks(kind, id));
      this.rows.set(r.schemes);
      this.editable.set(r.canEdit);
      this.dirty.set(false);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(i: number, which: 'desktop' | 'onsite', on: boolean): void {
    this.rows.update((rows) => rows.map((r, j) => (j === i ? { ...r, [which]: on } : r)));
    this.dirty.set(true);
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.api.saveTicks(this.kind(), this.userId(), this.rows().map((x) => ({ code: x.code, desktop: x.desktop, onsite: x.onsite }))));
      this.toast.success(r.message);
      this.dirty.set(false);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
