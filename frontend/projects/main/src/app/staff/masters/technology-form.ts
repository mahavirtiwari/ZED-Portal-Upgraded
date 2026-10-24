import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';
import { MastersApi, TechnologyRequest } from './masters.api';

/** Add / edit a technology (Admin). Port of Views/Technology/Create.cshtml. */
@Component({
  selector: 'zed-staff-technology-form',
  imports: [FormsModule, RouterLink, MultiSelect],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row justify-content-center mt-4">
        <div class="col-sm-10">
          <h3 class="registration-title">{{ id ? 'Edit Technology' : 'Add New Technology' }}</h3>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }
          <form class="jumbotron row" (ngSubmit)="save()" novalidate>
            <div class="row">
              <div class="col-sm-4" style="margin-bottom: 9px">
                <div class="input-group">
                  <label class="input-group-text" for="technologyCode">Code<span style="color: red">*</span></label>
                  <input id="technologyCode" name="technologyCode" class="form-control" maxlength="200" [(ngModel)]="model.technologyCode" />
                </div>
                @if (submitted() && !model.technologyCode.trim()) { <span class="help-block">Technology Code required.</span> }
              </div>
              <div class="col-sm-12" style="margin-bottom: 9px">
                <label class="d-block" for="technologyName">Technology<span style="color: red">*</span></label>
                <input id="technologyName" name="technologyName" class="form-control" maxlength="200" style="max-width: 100%" [(ngModel)]="model.technologyName" />
                @if (submitted() && !model.technologyName.trim()) { <span class="help-block">Technology Name required.</span> }
              </div>
            </div>
            <div class="row">
              <div class="col-sm-6" style="margin-bottom: 9px">
                <label class="d-block" for="sectors">NIC Sector</label>
                <zed-multi-select inputId="sectors" label="NIC Sector" [options]="sectors()" [(value)]="model.sectors" />
              </div>
              <div class="col-sm-6">
                <label class="d-block" for="categories">Category</label>
                <zed-multi-select inputId="categories" label="Category" [options]="categories()" [(value)]="model.categories" />
              </div>
            </div>
            <div class="row">
              <div class="col-sm-12" style="margin-bottom: 9px">
                <label class="d-block" for="description">Description</label>
                <textarea id="description" name="description" rows="3" class="form-control input-100" maxlength="2000" [(ngModel)]="model.description"></textarea>
              </div>
            </div>
            <div class="row align-items-end mb-3">
              <div class="col-sm-10"><a routerLink="/staff/masters/technologies" class="btn btn-primary">Back</a></div>
              <div class="col-sm-2"><button type="submit" class="btn btn-primary btn-block w-100" [disabled]="saving() || loading()">Save</button></div>
            </div>
          </form>
        </div>
      </div>
    </div>
  `,
  styles: `.help-block { color: #a94442; font-size: 13px; }`,
})
export class TechnologyFormPage {
  private readonly api = inject(MastersApi);

  protected readonly id: number | null = Number(inject(ActivatedRoute).snapshot.paramMap.get('id')) || null;
  protected model: TechnologyRequest = emptyTechnology();
  protected readonly sectors = signal<MultiSelectOption[]>([]);
  protected readonly categories = signal<MultiSelectOption[]>([]);
  /** Also re-renders the form once the (plain, ngModel-bound) model is loaded. */
  protected readonly loading = signal(true);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const options = await firstValueFrom(this.api.technologyOptions());
      this.sectors.set(options.sectors.map((s) => ({ value: s, label: s })));
      this.categories.set(options.categories.map((c) => ({ value: c, label: c })));
      if (this.id) {
        const t = (await firstValueFrom(this.api.technologies())).find((x) => x.id === this.id);
        if (!t) {
          this.error.set('Technology not found.');
          return;
        }
        this.model = {
          technologyCode: t.technologyCode, technologyName: t.technologyName, description: t.description ?? '',
          sectors: t.sectors, categories: t.categories,
        };
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.error.set('');
    this.success.set('');
    if (!this.model.technologyCode.trim() || !this.model.technologyName.trim()) {
      this.error.set('Please enter valid data.');
      return;
    }
    this.saving.set(true);
    try {
      // The old page stayed on the form: an added technology cleared it ("Sector saved.", its wording), an edit kept it.
      if (this.id) {
        await firstValueFrom(this.api.updateTechnology(this.id, this.model));
        this.success.set('Technology data updated.');
      } else {
        await firstValueFrom(this.api.addTechnology(this.model));
        this.model = emptyTechnology();
        this.submitted.set(false);
        this.success.set('Sector saved.');
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}

function emptyTechnology(): TechnologyRequest {
  return { technologyCode: '', technologyName: '', description: '', sectors: [], categories: [] };
}
