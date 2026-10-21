import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MastersApi, Technology } from './masters.api';

/** Technologies (Admin). Port of Views/Technology/List.cshtml: list, edit link, activate / deactivate. */
@Component({
  selector: 'zed-staff-technologies',
  imports: [RouterLink],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row justify-content-center mt-4">
        <div class="col-sm-10">
          <div class="row">
            <div class="col-sm-9"><h3 class="registration-title">Technologies</h3></div>
            <div class="col-sm-3 text-end"><a routerLink="/staff/masters/technologies/new" class="btn btn-primary">Add New Technology</a></div>
          </div>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }
          <div class="table-responsive">
            <table class="table table-default table-zed table-bordered bg-white">
              <thead>
                <tr>
                  <th>Technology Code</th>
                  <th>Technology Name</th>
                  <th>NIC Sectors</th>
                  <th>Categories</th>
                  <th>Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (t of technologies(); track t.id) {
                  <tr>
                    <td>{{ t.technologyCode }}</td>
                    <td>{{ t.technologyName }}</td>
                    <td>@for (s of t.sectors; track $index) { <p class="mb-1">{{ s }}</p> }</td>
                    <td>@for (c of t.categories; track $index) { <p class="mb-1">{{ c }}</p> }</td>
                    <td class="description">{{ t.description }}</td>
                    <td class="text-center" style="width: 140px">
                      <a class="btn btn-primary" [routerLink]="['/staff/masters/technologies', t.id]">Edit</a><br /><br />
                      @if (t.isActive) {
                        <button type="button" class="btn btn-danger" [disabled]="saving()" (click)="setActive(t, false)">DE-ACTIVE</button>
                      } @else {
                        <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="setActive(t, true)">ACTIVE</button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="6" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `.description { white-space: pre-wrap; }`,
})
export class TechnologiesPage {
  private readonly api = inject(MastersApi);

  protected readonly technologies = signal<Technology[]>([]);
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
      this.technologies.set(await firstValueFrom(this.api.technologies()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
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
