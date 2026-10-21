import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MastersApi, Parameter } from './masters.api';

/**
 * Questionnaire parameters of a certification level (Admin landing page). Port of
 * Views/Questionaire/Index.cshtml (Questionaire/Index?SectionType=Bronze). The description used to be
 * rendered as raw HTML; it is shown as text now. "Requirements" opens staff/questionnaire/{level}/{code}.
 */
@Component({
  selector: 'zed-staff-parameters',
  imports: [FormsModule],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4 justify-content-center">
        <div class="col-sm-10">
          <h3 class="registration-title">Parameters ({{ sectionType }})</h3>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }
          <form class="jumbotron row" (ngSubmit)="add()" novalidate>
            <div class="col-sm-4" style="margin-bottom: 9px">
              <div class="input-group mb-3">
                <label class="input-group-text" for="sectionCode">Parameter Code<span style="color: red">*</span></label>
                <input id="sectionCode" name="sectionCode" class="form-control" maxlength="50" [(ngModel)]="code" />
              </div>
              @if (submitted() && !code.trim()) { <span class="help-block">Parameter Code required.</span> }
            </div>
            <div class="col-sm-8">
              <div class="input-group mb-3">
                <label class="input-group-text" for="sectionName">Parameter Name<span style="color: red">*</span></label>
                <input id="sectionName" name="sectionName" class="form-control" maxlength="200" style="max-width: 100%" [(ngModel)]="name" />
              </div>
              @if (submitted() && !name.trim()) { <span class="help-block">Parameter Name required.</span> }
            </div>
            <div class="col-sm-12" style="margin-bottom: 9px">
              <div class="input-group mb-3">
                <label class="input-group-text" for="description">Description</label>
                <textarea id="description" name="description" class="form-control" maxlength="1990" style="max-width: 100%; height: 100px" [(ngModel)]="description"></textarea>
              </div>
            </div>
            <div class="row justify-content-end">
              <div class="col-sm-2"><button type="submit" class="btn btn-primary btn-block w-100" [disabled]="saving()">Save</button></div>
            </div>
          </form>

          <div class="table-responsive">
            <table class="table table-default table-zed table-bordered bg-white">
              <thead>
                <tr>
                  <th>Parameter Code</th>
                  <th>Parameter Name</th>
                  <th>Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (s of parameters(); track s.id) {
                  <tr>
                    <td>{{ s.sectionCode }}</td>
                    <th>{{ s.sectionName }}</th>
                    <td class="text-justify"><pre>{{ s.description }}</pre></td>
                    <td class="text-end">
                      <button type="button" class="btn btn-danger btn-sm" (click)="edit(s)">Edit</button><br /><br />
                      <a class="btn btn-primary btn-sm" [href]="requirementsUrl(s)">Requirements</a>
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
                <div style="margin-bottom: 9px">
                  <label for="edit-name"><strong>Parameter Name<span style="color: red">*</span></strong></label>
                  <input id="edit-name" name="editName" class="form-control" maxlength="200" style="max-width: 100%" [(ngModel)]="e.sectionName" />
                </div>
                <label for="edit-description"><strong>Description</strong></label>
                <textarea id="edit-description" name="editDescription" rows="5" class="form-control" maxlength="1990" style="max-width: 100%; height: 100px"
                          [(ngModel)]="e.description"></textarea>
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
    pre { color: #333; font-size: 14px; white-space: pre-wrap; word-wrap: break-word; background-color: #fff; font-family: inherit; }
  `,
})
export class ParametersPage {
  private readonly api = inject(MastersApi);
  private readonly legacyUrl = signal('');

  protected readonly sectionType: string = inject(ActivatedRoute).snapshot.paramMap.get('sectionType') ?? 'Bronze';
  protected readonly parameters = signal<Parameter[]>([]);
  protected readonly editing = signal<{ id: number; sectionName: string; description: string } | null>(null);
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
    void this.load();
  }

  protected requirementsUrl(p: Parameter): string {
    return `/staff/questionnaire/${encodeURIComponent(p.sectionType || this.sectionType)}/${encodeURIComponent(p.sectionCode)}`;
  }

  private async load(): Promise<void> {
    try {
      this.parameters.set(await firstValueFrom(this.api.parameters(this.sectionType)));
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
      this.success.set((await firstValueFrom(this.api.addParameter(this.sectionType, this.code.trim(), this.name.trim(), this.description))).message);
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
      this.success.set((await firstValueFrom(this.api.updateParameter(this.sectionType, e.id, e.sectionName.trim(), e.description))).message);
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
