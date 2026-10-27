import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { MastersApi, Parameter } from './masters.api';
import { CollapseCard } from '../collapse-card';

/**
 * Questionnaire parameters of a certification level (Admin landing page). Port of
 * Views/Questionaire/Index.cshtml (Questionaire/Index?SectionType=Bronze). The description used to be
 * rendered as raw HTML; it is shown as text now. "Requirements" opens staff/questionnaire/{level}/{code}. V4: the add
 * form in a card, long descriptions folded to three lines.
 */
@Component({
  selector: 'zed-staff-parameters',
  imports: [FormsModule, CollapseCard],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Parameters ({{ sectionType() }})</h3>
        <p class="page-sub">Parameters of the {{ sectionType() }} questionnaire; Requirements opens the questions of a parameter.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <zed-collapse-card title="Add Parameter" summary="Open to add a new parameter.">
      <form class="add-form" (ngSubmit)="add()" novalidate>
        <div class="form-grid">
          <label for="sectionCode">Parameter Code<span class="req">*</span></label>
          <div>
            <input id="sectionCode" name="sectionCode" class="form-control" maxlength="50" [(ngModel)]="code" />
            @if (submitted() && !code.trim()) { <span class="help-block">Parameter Code required.</span> }
          </div>
          <label for="sectionName">Parameter Name<span class="req">*</span></label>
          <div>
            <input id="sectionName" name="sectionName" class="form-control" maxlength="200" [(ngModel)]="name" />
            @if (submitted() && !name.trim()) { <span class="help-block">Parameter Name required.</span> }
          </div>
          <label for="description">Description</label>
          <textarea id="description" name="description" rows="4" class="form-control" maxlength="1990" [(ngModel)]="description"></textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="saving()">Save</button>
        </div>
      </form>
    </zed-collapse-card>

    <div class="table-responsive">
      <!-- Fixed columns so the table fits the screen: the description wraps in what is left. -->
      <table class="table table-zed table-bordered param-table">
        <colgroup>
          <col style="width: 110px" />
          <col style="width: 22%" />
          <col />
          <col style="width: 250px" />
        </colgroup>
        <thead>
          <tr>
            <th class="text-center">Parameter Code</th>
            <th class="text-center">Parameter Name</th>
            <th>Description</th>
            <th class="text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (s of parameters(); track s.id) {
            <tr>
              <td class="text-center">{{ s.sectionCode }}</td>
              <td class="text-center"><strong>{{ s.sectionName }}</strong></td>
              <td class="description">
                @if (s.description) {
                  <pre [class.clamp-3]="!expanded().has(s.id)" [title]="s.description">{{ s.description }}</pre>
                  @if (isLong(s.description)) {
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="toggle(s.id)">{{ expanded().has(s.id) ? 'less' : 'more' }}</button>
                  }
                }
              </td>
              <td>
                <div class="row-actions justify-content-center">
                  <button type="button" class="btn btn-outline-primary" (click)="edit(s)">Edit</button>
                  <a class="btn btn-primary" [href]="requirementsUrl(s)">Requirements</a>
                </div>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4" style="padding: 0"><div class="no-data">No Data</div></td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="edit-parameter-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="edit-parameter-title">Edit Parameter</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="update()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="edit-name">Parameter Name<span class="req">*</span></label>
                  <input id="edit-name" name="editName" class="form-control" maxlength="200" [(ngModel)]="e.sectionName" />
                  <label for="edit-description">Description</label>
                  <textarea id="edit-description" name="editDescription" rows="5" class="form-control" maxlength="1990" [(ngModel)]="e.description"></textarea>
                </div>
                @if (editError()) { <span class="help-block" role="alert">{{ editError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">UPDATE</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    .param-table { table-layout: fixed; width: 100%; min-width: 760px; }
    .param-table td { vertical-align: middle; overflow-wrap: anywhere; }
    pre { color: #333; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; background-color: transparent; font-family: inherit; margin: 0; }
  `,
})
export class ParametersPage {
  private readonly api = inject(MastersApi);
  private readonly legacyUrl = signal('');

  /** Bronze, Silver or Gold; the page reloads when the menu's Questionnaire drop-down switches level. */
  protected readonly sectionType = signal('Bronze');
  protected readonly parameters = signal<Parameter[]>([]);
  protected readonly editing = signal<{ id: number; sectionName: string; description: string } | null>(null);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly editError = signal('');
  protected readonly success = signal('');
  protected code = '';
  protected name = '';
  protected description = '';

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    inject(ActivatedRoute).paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.sectionType.set(params.get('sectionType') ?? 'Bronze');
      this.editing.set(null);
      this.success.set('');
      this.error.set('');
      void this.load();
    });
  }

  protected requirementsUrl(p: Parameter): string {
    return `/staff/questionnaire/${encodeURIComponent(p.sectionType || this.sectionType())}/${encodeURIComponent(p.sectionCode)}`;
  }

  /** Descriptions over about three lines get the more / less link. */
  protected isLong(text: string): boolean {
    return text.length > 160 || text.split('\n').length > 3;
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  private async load(): Promise<void> {
    try {
      this.parameters.set(await firstValueFrom(this.api.parameters(this.sectionType())));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected async add(): Promise<void> {
    this.submitted.set(true);
    this.error.set('');
    this.success.set('');
    if (!this.code.trim() || !this.name.trim()) {
      this.error.set('Please enter valid data.');
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.addParameter(this.sectionType(), this.code.trim(), this.name.trim(), this.description))).message);
      this.code = this.name = this.description = '';
      this.submitted.set(false);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected edit(p: Parameter): void {
    this.editError.set('');
    this.success.set('');
    this.editing.set({ id: p.id, sectionName: p.sectionName, description: p.description ?? '' });
  }

  protected async update(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    if (!e.sectionName.trim()) {
      this.editError.set('Enter the valid data.');
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.updateParameter(this.sectionType(), e.id, e.sectionName.trim(), e.description))).message);
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
