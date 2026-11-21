import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import {
  SchemeSummary, SchemesAdminApi, SchemesResponse, activationLabel, codeFrom, flowLabel, gradeKeyLabel, gradingModeLabel, rupees,
} from './schemes-admin.api';

interface NewScheme { name: string; code: string; codeTouched: boolean; template: string }

/**
 * Admin → Incentives → Incentive Schemes (2026-11-20, approved design, docs/INCENTIVE-SCHEMES.md): every scheme with when it
 * opens, how it is graded, its verification flow and its on / off switch; "New scheme" starts one from Financial Assistance,
 * Technology Upgradation or blank (off until switched on). Schemes are never deleted, only switched off.
 */
@Component({
  selector: 'zed-staff-schemes-list',
  imports: [FormsModule, RouterLink, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Incentive Schemes' | t: 'staff.incentivesAdmin.list.title' }}</h3>
        <p class="page-sub">{{ 'The schemes units apply for from their dashboard: when each opens, the benefit, the form and the verification.' | t: 'staff.incentivesAdmin.list.sub' }}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-default" routerLink="/staff/incentives/dashboard-cards">{{ 'Main Dashboard Cards' | t: 'staff.incentivesAdmin.list.cardsLink' }}</a>
        <button type="button" class="btn btn-primary" [disabled]="busy() || !data()" (click)="openNew()">{{ 'New scheme' | t: 'staff.incentivesAdmin.list.newButton' }}</button>
      </div>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }

    @if (data(); as d) {
      <div class="table-responsive">
        <table class="table table-zed sl-table">
          <thead>
            <tr>
              <th>{{ 'Scheme' | t: 'staff.incentivesAdmin.list.column.name' }}</th>
              <th>{{ 'Card title' | t: 'staff.incentivesAdmin.list.column.card' }}</th>
              <th>{{ 'Opens after' | t: 'staff.incentivesAdmin.list.column.opens' }}</th>
              <th>{{ 'Grading' | t: 'staff.incentivesAdmin.list.column.grading' }}</th>
              <th>{{ 'Verification' | t: 'staff.incentivesAdmin.list.column.flow' }}</th>
              <th>{{ 'Active' | t: 'staff.incentivesAdmin.list.column.active' }}</th>
              <th class="text-end">{{ 'Action' | t: 'staff.incentivesAdmin.list.column.action' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (s of d.schemes; track s.code) {
              <tr [class.is-off]="!s.active" [attr.data-code]="s.code">
                <td><strong>{{ s.name }}</strong><small class="muted d-block sl-code">{{ s.code }}</small></td>
                <td>{{ s.cardTitle }}</td>
                <td>{{ opens(s) }}</td>
                <td>
                  <span class="type-name">{{ gradingMode(s) }}</span>
                  @for (g of s.grading.rows; track g.key) {
                    <small class="d-block sl-grade">{{ '{key}: {share}% up to {max}' | t: 'staff.incentivesAdmin.list.gradeRow' : gradeRow(g) }}</small>
                  }
                </td>
                <td>{{ flow(s) }}</td>
                <td>
                  <label class="af-switch" [class.off]="!s.active">
                    <input type="checkbox" role="switch" [checked]="s.active" [disabled]="busy()"
                           [attr.aria-label]="'Switch {name} on or off' | t: 'staff.incentivesAdmin.list.switchAria' : { name: s.name }"
                           (click)="$event.preventDefault(); toggle(s)" />
                    <span class="af-track" aria-hidden="true"></span>{{ s.active ? ('On' | t: 'staff.incentivesAdmin.list.on') : ('Off' | t: 'staff.incentivesAdmin.list.off') }}
                  </label>
                </td>
                <td class="text-end"><a class="btn btn-outline-primary btn-sm" [routerLink]="[s.code]">{{ 'Edit' | t: 'staff.incentivesAdmin.list.editButton' }}</a></td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="no-data">{{ 'No scheme yet. Use New scheme to add one.' | t: 'staff.incentivesAdmin.list.emptyNoScheme' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted sl-note">{{ 'A scheme is never deleted: switch it off. Applications already made continue.' | t: 'staff.incentivesAdmin.list.note' }}</p>
    }

    @if (creating(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sl-new-title">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="sl-new-title">{{ 'New scheme' | t: 'staff.incentivesAdmin.new.title' }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.incentivesAdmin.new.closeAria'" (click)="creating.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="create(c)" novalidate>
              <div class="modal-body">
                <label class="form-label" for="sl-name">{{ 'Name' | t: 'staff.incentivesAdmin.new.nameLabel' }}<span class="req">*</span></label>
                <input id="sl-name" name="name" class="form-control" maxlength="200" [(ngModel)]="c.name" (ngModelChange)="nameChanged(c)" />
                <label class="form-label mt-3" for="sl-code">{{ 'Code' | t: 'staff.incentivesAdmin.new.codeLabel' }}<span class="req">*</span></label>
                <input id="sl-code" name="code" class="form-control" maxlength="40" [(ngModel)]="c.code" (ngModelChange)="c.codeTouched = true" />
                <small class="muted">{{ 'Capital letters, digits and _ . It cannot be changed later.' | t: 'staff.incentivesAdmin.new.codeHelp' }}</small>
                <span class="form-label d-block mt-3">{{ 'Start from' | t: 'staff.incentivesAdmin.new.templateLabel' }}</span>
                @for (o of templates(); track o.value) {
                  <label class="sl-choice">
                    <input type="radio" name="template" [value]="o.value" [(ngModel)]="c.template" />
                    <span>{{ o.label }}</span>
                  </label>
                }
                @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="creating.set(null)">{{ 'Cancel' | t: 'staff.incentivesAdmin.new.cancelButton' }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ 'Create' | t: 'staff.incentivesAdmin.new.createButton' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (busy()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .sl-table { min-width: 860px; }
    .sl-table td { vertical-align: middle; overflow-wrap: break-word; }
    .sl-table tr.is-off td { color: #8a9899; }
    .sl-code { font-family: monospace; font-size: 12px; }
    .sl-grade { font-size: 12px; color: #5f6f70; }
    .sl-note { font-size: 13px; margin-top: 8px; }
    .sl-choice { display: flex; align-items: center; gap: 8px; font-weight: 400; margin: 4px 0; cursor: pointer; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SchemesListPage {
  private readonly api = inject(SchemesAdminApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<SchemesResponse | null>(null);
  protected readonly creating = signal<NewScheme | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');

  constructor() {
    void this.load();
  }

  protected opens(s: SchemeSummary): string {
    return activationLabel(s.activation, this.data()?.levels ?? []);
  }

  protected gradingMode(s: SchemeSummary): string {
    return gradingModeLabel(s.grading.mode);
  }

  protected gradeRow(g: { key: string; sharePercent: number; maxAmount: number }): Record<string, unknown> {
    return { key: gradeKeyLabel(g.key, this.data()?.levels ?? []), share: g.sharePercent, max: rupees(g.maxAmount) };
  }

  protected flow(s: SchemeSummary): string {
    return flowLabel(s.flow);
  }

  protected templates(): { value: string; label: string }[] {
    const names: Record<string, string> = {
      FA: t('staff.incentivesAdmin.new.templateFa', 'Financial Assistance (certificate and expenditure)'),
      TU: t('staff.incentivesAdmin.new.templateTu', 'Technology Upgradation (technologies, "Add more")'),
    };
    return [
      ...(this.data()?.templates ?? []).map((v) => ({ value: v, label: names[v] ?? v })),
      { value: '', label: t('staff.incentivesAdmin.new.templateBlank', 'Blank (one section)') },
    ];
  }

  protected openNew(): void {
    this.modalError.set('');
    this.creating.set({ name: '', code: '', codeTouched: false, template: 'FA' });
  }

  protected nameChanged(c: NewScheme): void {
    if (!c.codeTouched) c.code = codeFrom(c.name);
  }

  protected async create(c: NewScheme): Promise<void> {
    const code = c.code.trim().toUpperCase();
    if (!c.name.trim() || !code) {
      this.modalError.set(t('staff.incentivesAdmin.new.requiredError', 'Enter the name and the code.'));
      return;
    }
    this.busy.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(this.api.create({ template: c.template || null, code, name: c.name.trim() }));
      this.creating.set(null);
      await this.router.navigate([code], { relativeTo: this.route });
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(s: SchemeSummary): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.setActive(s.code, !s.active))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.api.list()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }
}
