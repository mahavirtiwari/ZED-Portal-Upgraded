import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';
import { ToastService } from '../toast';
import { MastersApi, TechnologyRequest } from './masters.api';
import { TextPipe, t } from '../../content/page-text';

/**
 * Add / edit a technology (Admin). Port of Views/Technology/Create.cshtml. V4: one card, Back in the page head. V4 layout:
 * the fields in three sections (the technology, where it applies, description with a character count) and, beside
 * them, a live preview of the technology as the list shows it.
 */
@Component({
  selector: 'zed-staff-technology-form',
  imports: [FormsModule, RouterLink, MultiSelect, TextPipe],
  template: `
    <div class="back-row">
      <nav class="crumbs" [attr.aria-label]="'Breadcrumb' | t: 'staff.technologyForm.crumbs.aria'">
        <span>{{ 'Technology Upgradation' | t: 'staff.technologyForm.crumb.upgradation' }}</span><span aria-hidden="true">›</span>
        <a routerLink="/staff/masters/technologies">{{ 'Technologies' | t: 'staff.technologyForm.crumb.technologies' }}</a><span aria-hidden="true">›</span>
        <span aria-current="page">{{ id ? ('Edit' | t: 'staff.technologyForm.crumb.edit') : ('Add' | t: 'staff.technologyForm.crumb.add') }}</span>
      </nav>
      <a routerLink="/staff/masters/technologies" class="btn btn-outline-primary btn-sm back-btn">{{ '← Back' | t: 'staff.technologyForm.back.button' }}</a>
    </div>
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ id ? ('Edit Technology' | t: 'staff.technologyForm.edit.title') : ('Add New Technology' | t: 'staff.technologyForm.add.title') }}</h3>
        <p class="page-sub">{{ 'A technology the MSMEs can choose under Technology Upgradation, with the NIC sectors and categories it applies to.' | t: 'staff.technologyForm.sub' }}</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    <form class="tf-layout" (ngSubmit)="save()" novalidate>
      <div class="tf-main">
        <section class="zed-card tf-section" aria-labelledby="tf-h-tech">
          <h4 id="tf-h-tech"><span class="tf-no" aria-hidden="true">1</span>{{ 'Technology' | t: 'staff.technologyForm.section.technology.title' }}</h4>
          <div class="form-grid">
            <label for="technologyCode">{{ 'Code' | t: 'staff.technologyForm.code.label' }}<span class="req">*</span></label>
            <div>
              <input id="technologyCode" name="technologyCode" class="form-control" maxlength="200" [(ngModel)]="model.technologyCode" />
              @if (submitted() && !model.technologyCode.trim()) { <span class="help-block">{{ 'Technology Code required.' | t: 'staff.technologyForm.code.error' }}</span> }
            </div>
            <label for="technologyName">{{ 'Technology' | t: 'staff.technologyForm.name.label' }}<span class="req">*</span></label>
            <div>
              <input id="technologyName" name="technologyName" class="form-control" maxlength="200" [(ngModel)]="model.technologyName" />
              @if (submitted() && !model.technologyName.trim()) { <span class="help-block">{{ 'Technology Name required.' | t: 'staff.technologyForm.name.error' }}</span> }
            </div>
          </div>
        </section>

        <section class="zed-card tf-section" aria-labelledby="tf-h-where">
          <h4 id="tf-h-where"><span class="tf-no" aria-hidden="true">2</span>{{ 'Where it applies' | t: 'staff.technologyForm.section.where.title' }}</h4>
          <div class="form-grid">
            <label class="top" for="sectors">{{ 'NIC Sector' | t: 'staff.technologyForm.sectors.label' }}</label>
            <div>
              <zed-multi-select inputId="sectors" [label]="'NIC Sector' | t: 'staff.technologyForm.sectors.label'" [options]="sectors()" [(value)]="model.sectors" />
              <small class="muted d-block mt-1">{{ '{chosen} of {total} chosen' | t: 'staff.technologyForm.chosen.note' : { chosen: model.sectors.length, total: sectors().length } }}</small>
            </div>
            <label class="top" for="categories">{{ 'Category' | t: 'staff.technologyForm.categories.label' }}</label>
            <div>
              <zed-multi-select inputId="categories" [label]="'Category' | t: 'staff.technologyForm.categories.label'" [options]="categories()" [(value)]="model.categories" />
              <small class="muted d-block mt-1">{{ '{chosen} of {total} chosen' | t: 'staff.technologyForm.chosen.note' : { chosen: model.categories.length, total: categories().length } }}</small>
            </div>
          </div>
        </section>

        <section class="zed-card tf-section" aria-labelledby="tf-h-desc">
          <h4 id="tf-h-desc"><span class="tf-no" aria-hidden="true">3</span>{{ 'Description' | t: 'staff.technologyForm.section.description.title' }}</h4>
          <label class="visually-hidden" for="description">{{ 'Description' | t: 'staff.technologyForm.description.label' }}</label>
          <textarea id="description" name="description" rows="5" class="form-control" maxlength="2000" [(ngModel)]="model.description"
                    [placeholder]="'What the technology is and which units it suits' | t: 'staff.technologyForm.description.placeholder'"></textarea>
          <small class="muted d-block mt-1 text-end tf-count">{{ model.description.length }} / 2000</small>
        </section>
        <!-- 2026-11-19 (admin audit): Save under the fields, not under the preview. -->
        <div class="form-actions tf-actions">
          <a routerLink="/staff/masters/technologies" class="btn btn-default">{{ 'Cancel' | t: 'staff.technologyForm.cancel.button' }}</a>
          <button type="submit" class="btn btn-primary" [disabled]="saving() || loading()">{{ 'Save' | t: 'staff.technologyForm.save.button' }}</button>
        </div>
      </div>

      <aside class="tf-side">
        <div class="zed-card tf-preview" [attr.aria-label]="'Preview' | t: 'staff.technologyForm.preview.aria'">
          <span class="tf-preview-h">{{ 'Preview in the list' | t: 'staff.technologyForm.preview.title' }}</span>
          <div class="tf-row"><span class="code-badge">{{ model.technologyCode.trim() || ('Code' | t: 'staff.technologyForm.preview.code.label') }}</span></div>
          <div class="tf-name" [class.muted]="!model.technologyName.trim()">{{ model.technologyName.trim() || ('Technology name' | t: 'staff.technologyForm.preview.name.label') }}</div>
          @if (model.description.trim()) { <div class="tf-desc clamp-3">{{ model.description }}</div> }
          <div class="tf-label">{{ 'NIC Sectors' | t: 'staff.technologyForm.preview.sectors.label' }}</div>
          <div>@for (s of model.sectors; track s) { <span class="zed-chip">{{ s }}</span> } @empty { <span class="muted">—</span> }</div>
          <div class="tf-label">{{ 'Categories' | t: 'staff.technologyForm.preview.categories.label' }}</div>
          <div>@for (c of model.categories; track c) { <span class="zed-chip cat">{{ c }}</span> } @empty { <span class="muted">—</span> }</div>
        </div>
      </aside>
    </form>
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    .back-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .crumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: #5f6f70; }
    .crumbs a { color: var(--zt-mid2, #2f7c83); font-weight: 600; text-decoration: none; }
    .crumbs [aria-current] { color: var(--zt-dark, #1f5c61); font-weight: 700; }
    .back-btn { white-space: nowrap; }
    /* Long option names (categories) wrap inside their tile; the list never scrolls sideways. */
    .tf-section ::ng-deep .options, .tf-section ::ng-deep .options.wide { grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); }
    .tf-section ::ng-deep .options > li { min-width: 0; }
    .tf-section ::ng-deep .option > span { min-width: 0; overflow-wrap: break-word; }
    .form-grid > label.top { align-self: start; padding-top: 8px; }
    @media (min-width: 768px) { .form-grid { grid-template-columns: minmax(120px, 160px) minmax(0, 1fr); } }

    .tf-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .tf-section { margin-bottom: 16px; }
    .tf-section h4 { display: flex; align-items: center; gap: 10px; }
    .tf-no { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 13px; display: inline-grid; place-items: center; font-size: 13px; font-weight: 800;
      background: #eef6f6; color: var(--zt-mid2, #2f7c83); }
    .tf-count { font-size: 12px; }

    .tf-side { position: sticky; top: 16px; }
    .tf-preview { margin-bottom: 12px; border-top: 4px solid #45a5ad; }
    .tf-preview-h { display: block; font-size: 12px; font-weight: 700; color: #5f6f70; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 10px; }
    .tf-row { margin-bottom: 8px; }
    .code-badge { display: inline-flex; align-items: center; min-height: 28px; padding: 3px 10px; border-radius: 14px; background: #eef6f6; color: #23474a;
      font-weight: 700; font-size: 13px; overflow-wrap: break-word; max-width: 100%; }
    .tf-name { font-weight: 700; color: #232527; font-size: 15px; overflow-wrap: break-word; }
    .tf-desc { white-space: pre-wrap; color: #5f6f70; font-size: 13px; line-height: 1.5; margin-top: 4px; overflow-wrap: break-word; }
    .tf-label { font-size: 12px; font-weight: 600; color: #5f6f70; margin: 10px 0 2px; }
    .tf-preview { min-width: 0; overflow-wrap: break-word; }
    .zed-chip { overflow-wrap: break-word; max-width: 100%; }
    .zed-chip.cat { background: #f1f0fb; color: #3f3a7a; }
    .tf-actions { margin-top: 0; display: flex; justify-content: flex-end; gap: 8px; }

    @media (max-width: 991.98px) {
      .tf-layout { grid-template-columns: minmax(0, 1fr); }
      .tf-side { position: static; }
    }
  `,
})
export class TechnologyFormPage {
  private readonly api = inject(MastersApi);
  /** 2026-11-19 (admin audit): the saved message as a toast at the bottom, near Save (the alert at the top was out of view). */
  private readonly toast = inject(ToastService);

  protected readonly id: number | null = Number(inject(ActivatedRoute).snapshot.paramMap.get('id')) || null;
  protected model: TechnologyRequest = emptyTechnology();
  protected readonly sectors = signal<MultiSelectOption[]>([]);
  protected readonly categories = signal<MultiSelectOption[]>([]);
  /** Also re-renders the form once the (plain, ngModel-bound) model is loaded. */
  protected readonly loading = signal(true);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const options = await firstValueFrom(this.api.technologyOptions());
      this.sectors.set(options.sectors.map((s) => ({ value: s, label: s })));
      this.categories.set(options.categories.map((c) => ({ value: c, label: c })));
      if (this.id) {
        const tech = (await firstValueFrom(this.api.technologies())).find((x) => x.id === this.id);
        if (!tech) {
          this.error.set(t('staff.technologyForm.notFound.error', 'Technology not found.'));
          return;
        }
        this.model = {
          technologyCode: tech.technologyCode, technologyName: tech.technologyName, description: tech.description ?? '',
          sectors: tech.sectors, categories: tech.categories,
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
    if (!this.model.technologyCode.trim() || !this.model.technologyName.trim()) {
      this.error.set(t('staff.technologyForm.invalid.error', 'Please enter valid data.'));
      return;
    }
    this.saving.set(true);
    try {
      // The old page stayed on the form: an added technology cleared it ("Sector saved.", its wording), an edit kept it.
      if (this.id) {
        await firstValueFrom(this.api.updateTechnology(this.id, this.model));
        this.toast.success(t('staff.technologyForm.updated.toast', 'Technology data updated.'));
      } else {
        await firstValueFrom(this.api.addTechnology(this.model));
        this.model = emptyTechnology();
        this.submitted.set(false);
        this.toast.success(t('staff.technologyForm.added.toast', 'Sector saved.'));
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
