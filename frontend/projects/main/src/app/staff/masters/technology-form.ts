import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';
import { MastersApi, TechnologyRequest } from './masters.api';

/**
 * Add / edit a technology (Admin). Port of Views/Technology/Create.cshtml. V4: one card, Back in the page head. V4 layout:
 * the fields in three sections (the technology, where it applies, description with a character count) and, beside
 * them, a live preview of the technology as the list shows it.
 */
@Component({
  selector: 'zed-staff-technology-form',
  imports: [FormsModule, RouterLink, MultiSelect],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ id ? 'Edit Technology' : 'Add New Technology' }}</h3>
        <p class="page-sub">A technology the MSMEs can choose under Technology Upgradation, with the NIC sectors and categories it applies to.</p>
      </div>
      <div class="page-actions">
        <a routerLink="/staff/masters/technologies" class="btn btn-default">Back</a>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <form class="tf-layout" (ngSubmit)="save()" novalidate>
      <div class="tf-main">
        <section class="zed-card tf-section" aria-labelledby="tf-h-tech">
          <h4 id="tf-h-tech"><span class="tf-no" aria-hidden="true">1</span>Technology</h4>
          <div class="form-grid">
            <label for="technologyCode">Code<span class="req">*</span></label>
            <div>
              <input id="technologyCode" name="technologyCode" class="form-control" maxlength="200" [(ngModel)]="model.technologyCode" />
              @if (submitted() && !model.technologyCode.trim()) { <span class="help-block">Technology Code required.</span> }
            </div>
            <label for="technologyName">Technology<span class="req">*</span></label>
            <div>
              <input id="technologyName" name="technologyName" class="form-control" maxlength="200" [(ngModel)]="model.technologyName" />
              @if (submitted() && !model.technologyName.trim()) { <span class="help-block">Technology Name required.</span> }
            </div>
          </div>
        </section>

        <section class="zed-card tf-section" aria-labelledby="tf-h-where">
          <h4 id="tf-h-where"><span class="tf-no" aria-hidden="true">2</span>Where it applies</h4>
          <div class="form-grid">
            <label class="top" for="sectors">NIC Sector</label>
            <div>
              <zed-multi-select inputId="sectors" label="NIC Sector" [options]="sectors()" [(value)]="model.sectors" />
              <small class="muted d-block mt-1">{{ model.sectors.length }} of {{ sectors().length }} chosen</small>
            </div>
            <label class="top" for="categories">Category</label>
            <div>
              <zed-multi-select inputId="categories" label="Category" [options]="categories()" [(value)]="model.categories" />
              <small class="muted d-block mt-1">{{ model.categories.length }} of {{ categories().length }} chosen</small>
            </div>
          </div>
        </section>

        <section class="zed-card tf-section" aria-labelledby="tf-h-desc">
          <h4 id="tf-h-desc"><span class="tf-no" aria-hidden="true">3</span>Description</h4>
          <label class="visually-hidden" for="description">Description</label>
          <textarea id="description" name="description" rows="5" class="form-control" maxlength="2000" [(ngModel)]="model.description"
                    placeholder="What the technology is and which units it suits"></textarea>
          <small class="muted d-block mt-1 text-end tf-count">{{ model.description.length }} / 2000</small>
        </section>
      </div>

      <aside class="tf-side">
        <div class="zed-card tf-preview" aria-label="Preview">
          <span class="tf-preview-h">Preview in the list</span>
          <div class="tf-row"><span class="code-badge">{{ model.technologyCode.trim() || 'Code' }}</span></div>
          <div class="tf-name" [class.muted]="!model.technologyName.trim()">{{ model.technologyName.trim() || 'Technology name' }}</div>
          @if (model.description.trim()) { <div class="tf-desc clamp-3">{{ model.description }}</div> }
          <div class="tf-label">NIC Sectors</div>
          <div>@for (s of model.sectors; track s) { <span class="zed-chip">{{ s }}</span> } @empty { <span class="muted">—</span> }</div>
          <div class="tf-label">Categories</div>
          <div>@for (c of model.categories; track c) { <span class="zed-chip cat">{{ c }}</span> } @empty { <span class="muted">—</span> }</div>
        </div>
        <div class="form-actions tf-actions">
          <button type="submit" class="btn btn-primary" [disabled]="saving() || loading()">Save</button>
        </div>
      </aside>
    </form>
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    .form-grid > label.top { align-self: start; padding-top: 8px; }
    @media (min-width: 768px) { .form-grid { grid-template-columns: minmax(120px, 160px) minmax(0, 1fr); } }

    .tf-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .tf-section { margin-bottom: 16px; }
    .tf-section h4 { display: flex; align-items: center; gap: 10px; }
    .tf-no { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 13px; display: inline-grid; place-items: center; font-size: 13px; font-weight: 800;
      background: #eef6f6; color: #2f7c83; }
    .tf-count { font-size: 12px; }

    .tf-side { position: sticky; top: 16px; }
    .tf-preview { margin-bottom: 12px; border-top: 4px solid #45a5ad; }
    .tf-preview-h { display: block; font-size: 12px; font-weight: 700; color: #5f6f70; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 10px; }
    .tf-row { margin-bottom: 8px; }
    .code-badge { display: inline-flex; align-items: center; min-height: 28px; padding: 3px 10px; border-radius: 14px; background: #eef6f6; color: #23474a;
      font-weight: 700; font-size: 13px; overflow-wrap: anywhere; }
    .tf-name { font-weight: 700; color: #232527; font-size: 15px; overflow-wrap: anywhere; }
    .tf-desc { white-space: pre-wrap; color: #5f6f70; font-size: 13px; line-height: 1.5; margin-top: 4px; overflow-wrap: anywhere; }
    .tf-label { font-size: 12px; font-weight: 600; color: #5f6f70; margin: 10px 0 2px; }
    .zed-chip { overflow-wrap: anywhere; }
    .zed-chip.cat { background: #f1f0fb; color: #3f3a7a; }
    .tf-actions { margin-top: 0; }

    @media (max-width: 991.98px) {
      .tf-layout { grid-template-columns: minmax(0, 1fr); }
      .tf-side { position: static; }
    }
  `,
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
