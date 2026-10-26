import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { MastersApi, Technology } from './masters.api';

/**
 * Technologies (Admin). Port of Views/Technology/List.cshtml: list, edit link, activate / deactivate. V4: search, pages,
 * a status column, and long descriptions folded to three lines.
 */
@Component({
  selector: 'zed-staff-technologies',
  imports: [FormsModule, PagerComponent, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Technologies</h3>
        <p class="page-sub">Technologies the MSMEs can choose under Technology Upgradation, with their NIC sectors and categories.</p>
      </div>
      <div class="page-actions">
        <a routerLink="/staff/masters/technologies/new" class="btn btn-primary">+ Add New Technology</a>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <div class="filter-bar mb-3">
      <div class="filter wide">
        <input type="search" class="form-control" placeholder="Search code, name, sector or category" aria-label="Search technologies"
               [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 110px">Code</th>
            <th>Technology</th>
            <th>NIC Sectors</th>
            <th>Categories</th>
            <th>Description</th>
            <th style="width: 100px">Status</th>
            <th style="width: 190px">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (t of pager.page(); track t.id) {
            <tr>
              <td class="text-center">{{ t.technologyCode }}</td>
              <td><strong>{{ t.technologyName }}</strong></td>
              <td>@for (s of t.sectors; track $index) { <span class="zed-chip">{{ s }}</span> }</td>
              <td>@for (c of t.categories; track $index) { <span class="zed-chip">{{ c }}</span> }</td>
              <td class="description">
                @if (t.description) {
                  <div [class.clamp-3]="!expanded().has(t.id)" [title]="t.description">{{ t.description }}</div>
                  @if (t.description.length > 160) {
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="toggle(t.id)">{{ expanded().has(t.id) ? 'less' : 'more' }}</button>
                  }
                }
              </td>
              <td><span class="status-badge" [class.is-active]="t.isActive" [class.is-inactive]="!t.isActive">{{ t.isActive ? 'Active' : 'Inactive' }}</span></td>
              <td>
                <div class="row-actions">
                  <a class="btn btn-outline-primary" [routerLink]="['/staff/masters/technologies', t.id]">Edit</a>
                  @if (t.isActive) {
                    <button type="button" class="btn btn-outline-danger" [disabled]="saving()" (click)="setActive(t, false)">Deactivate</button>
                  } @else {
                    <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="setActive(t, true)">Activate</button>
                  }
                </div>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" style="padding: 0"><div class="no-data">{{ pager.search() ? 'No technology matches the search' : 'No Data' }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />
  `,
  styles: `.description { white-space: pre-wrap; min-width: 220px; }`,
})
export class TechnologiesPage {
  private readonly api = inject(MastersApi);

  protected readonly pager = new ClientPager<Technology>(10);
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    const message = (globalThis.history?.state as { message?: unknown } | null)?.message;
    if (typeof message === 'string') this.success.set(message);
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.pager.all.set(await firstValueFrom(this.api.technologies()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected async setActive(t: Technology, active: boolean): Promise<void> {
    if (!active && !window.confirm('Are you sure that you want to de-activate this technology?')) return;
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.setTechnologyActive(t.id, active))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
