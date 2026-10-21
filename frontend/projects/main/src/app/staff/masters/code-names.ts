import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CodeName, CodeNameKind, MastersApi } from './masters.api';

const LABELS: Record<CodeNameKind, { title: string; one: string }> = {
  sectors: { title: 'Sectors', one: 'Sector' },
  categories: { title: 'Categories', one: 'Category' },
};

/**
 * NIC sectors and categories (Admin). Port of Views/Sector/List.cshtml and Views/Category/List.cshtml
 * (same page; the route's `data.kind` picks the list): add a code and name, rename in a pop-up.
 */
@Component({
  selector: 'zed-staff-code-names',
  imports: [FormsModule],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row justify-content-center mt-4">
        <div class="col-sm-10">
          <h3 class="registration-title">{{ labels.title }}</h3>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }
          <form class="jumbotron row" (ngSubmit)="add()" novalidate>
            <div class="col-sm-4" style="margin-bottom: 9px">
              <div class="input-group">
                <label class="input-group-text" for="code">{{ labels.one }} Code<span style="color: red">*</span></label>
                <input id="code" name="code" class="form-control" maxlength="50" [(ngModel)]="code" />
              </div>
              @if (submitted() && !code.trim()) { <span class="help-block">{{ labels.one }} Code required.</span> }
            </div>
            <div class="col-sm-8">
              <div class="input-group">
                <label class="input-group-text" for="name">{{ labels.one }} Name<span style="color: red">*</span></label>
                <input id="name" name="name" class="form-control" maxlength="200" style="max-width: 100%" [(ngModel)]="name" />
              </div>
              @if (submitted() && !name.trim()) { <span class="help-block">{{ labels.one }} Name required.</span> }
            </div>
            <div class="row align-items-end mb-3 mt-2">
              <div class="col-sm-2"><button type="submit" class="btn btn-primary btn-block w-100" [disabled]="saving()">Save</button></div>
            </div>
          </form>

          <div class="table-responsive">
            <table class="table table-default table-zed table-bordered bg-white">
              <thead>
                <tr>
                  <th>{{ labels.one }} Code</th>
                  <th>{{ labels.one }} Name</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (s of rows(); track s.id) {
                  <tr>
                    <td>{{ s.code }}</td>
                    <th>{{ s.name }}</th>
                    <td class="text-end"><button type="button" class="btn btn-danger btn-sm" style="width: 100px" (click)="edit(s)">Edit</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="3" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="edit-title">Edit {{ labels.one }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="/Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="update()" novalidate>
              <div class="modal-body">
                <label for="edit-name"><strong>{{ labels.one }} Name<span style="color: red">*</span></strong></label>
                <input id="edit-name" name="editName" class="form-control" maxlength="200" style="max-width: 100%" [(ngModel)]="e.name" />
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
  styles: `.help-block { color: #a94442; font-size: 13px; }`,
})
export class CodeNamesPage {
  private readonly api = inject(MastersApi);

  protected readonly kind: CodeNameKind = inject(ActivatedRoute).snapshot.data['kind'] === 'categories' ? 'categories' : 'sectors';
  protected readonly labels = LABELS[this.kind];
  protected readonly rows = signal<CodeName[]>([]);
  protected readonly editing = signal<CodeName | null>(null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly editError = signal('');
  protected readonly success = signal('');
  protected code = '';
  protected name = '';

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.rows.set(await firstValueFrom(this.api.list(this.kind)));
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
      this.success.set((await firstValueFrom(this.api.add(this.kind, this.code.trim(), this.name.trim()))).message);
      this.code = this.name = '';
      this.submitted.set(false);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected edit(row: CodeName): void {
    this.editError.set('');
    this.success.set('');
    this.editing.set({ ...row });
  }

  protected async update(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    if (!e.name.trim()) {
      this.editError.set('Enter the valid data.');
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.rename(this.kind, e.id, e.name.trim()))).message);
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
