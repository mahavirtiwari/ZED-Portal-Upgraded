import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { CodeName, CodeNameKind, MastersApi } from './masters.api';

const LABELS: Record<CodeNameKind, { title: string; one: string; sub: string }> = {
  sectors: { title: 'Sectors', one: 'Sector', sub: 'NIC sectors used to classify the MSMEs and the technologies.' },
  categories: { title: 'Categories', one: 'Category', sub: 'Categories the technologies are grouped under.' },
};

/**
 * NIC sectors and categories (Admin). Port of Views/Sector/List.cshtml and Views/Category/List.cshtml
 * (same page; the route's `data.kind` picks the list): add a code and name, rename in a pop-up. V4: the add form in a
 * card, search and pages on the list.
 */
@Component({
  selector: 'zed-staff-code-names',
  imports: [FormsModule, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ labels.title }}</h3>
        <p class="page-sub">{{ labels.sub }}</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <form class="zed-card" (ngSubmit)="add()" novalidate>
      <h4>Add {{ labels.one }}</h4>
      <div class="form-grid">
        <label for="code">{{ labels.one }} Code<span class="req">*</span></label>
        <div>
          <input id="code" name="code" class="form-control" maxlength="50" [(ngModel)]="code" />
          @if (submitted() && !code.trim()) { <span class="help-block">{{ labels.one }} Code required.</span> }
        </div>
        <label for="name">{{ labels.one }} Name<span class="req">*</span></label>
        <div>
          <input id="name" name="name" class="form-control" maxlength="200" [(ngModel)]="name" />
          @if (submitted() && !name.trim()) { <span class="help-block">{{ labels.one }} Name required.</span> }
        </div>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" [disabled]="saving()">Save</button>
      </div>
    </form>

    <div class="filter-bar mb-3">
      <div class="filter wide">
        <input type="search" class="form-control" placeholder="Search code or name" [attr.aria-label]="'Search ' + labels.title.toLowerCase()"
               [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 160px">{{ labels.one }} Code</th>
            <th>{{ labels.one }} Name</th>
            <th style="width: 110px">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (s of pager.page(); track s.id) {
            <tr>
              <td class="text-center">{{ s.code }}</td>
              <td><strong>{{ s.name }}</strong></td>
              <td>
                <div class="row-actions">
                  <button type="button" class="btn btn-outline-primary" (click)="edit(s)">Edit</button>
                </div>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="3" style="padding: 0"><div class="no-data">{{ pager.search() ? 'No ' + labels.one.toLowerCase() + ' matches the search' : 'No Data' }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="edit-title">Edit {{ labels.one }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="update()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="edit-name">{{ labels.one }} Name<span class="req">*</span></label>
                  <input id="edit-name" name="editName" class="form-control" maxlength="200" [(ngModel)]="e.name" />
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
  styles: `.help-block { color: #a94442; font-size: 13px; }`,
})
export class CodeNamesPage {
  private readonly api = inject(MastersApi);

  protected readonly kind: CodeNameKind = inject(ActivatedRoute).snapshot.data['kind'] === 'categories' ? 'categories' : 'sectors';
  protected readonly labels = LABELS[this.kind];
  protected readonly pager = new ClientPager<CodeName>(10);
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
      this.pager.all.set(await firstValueFrom(this.api.list(this.kind)));
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
