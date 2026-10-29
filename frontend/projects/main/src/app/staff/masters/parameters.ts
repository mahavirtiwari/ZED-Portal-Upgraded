import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { MastersApi, Parameter, ParameterLevel } from './masters.api';
import { CollapseCard } from '../collapse-card';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';
import { ClientPager, PagerComponent } from '../pager';

/**
 * Questionnaire parameters of a certification level (Admin landing page). Port of
 * Views/Questionaire/Index.cshtml (Questionaire/Index?SectionType=Bronze). The description used to be
 * rendered as raw HTML; it is shown as text now. "Requirements" opens staff/questionnaire/{level}/{code}. V4: the add
 * form in a card, long descriptions folded to three lines, a search box and the list paged (Show N Entries). The levels
 * are those of Administration → Certification Levels (ZED-X included); a parameter can be limited to NIC sectors (all
 * sectors when none is chosen).
 */
@Component({
  selector: 'zed-staff-parameters',
  imports: [FormsModule, CollapseCard, PagerComponent, MultiSelect],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Parameters ({{ levelName() }})</h3>
        <p class="page-sub">Parameters of the {{ levelName() }} questionnaire, for all NIC sectors or the sectors chosen; Requirements opens the questions of a parameter.</p>
      </div>
      @if (levels().length) {
        <div class="level-pick">
          <label for="param-level" class="form-label m-0">Level</label>
          <select id="param-level" class="form-select" [ngModel]="sectionType()" (ngModelChange)="pickLevel($event)">
            @for (l of levels(); track l.code) { <option [value]="l.code">{{ l.name }}{{ l.isEnabled ? '' : ' (not open to MSMEs yet)' }}</option> }
          </select>
        </div>
      }
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
          <label for="nicSectors" class="top">NIC Sectors</label>
          <div>
            <zed-multi-select inputId="nicSectors" label="NIC Sectors" [options]="sectorOptions()" [(value)]="nicSectors" />
            <small class="muted d-block mt-1">None chosen: the parameter applies to every sector.</small>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="saving()">Save</button>
        </div>
      </form>
    </zed-collapse-card>

    <div class="filter-bar mb-3">
      <div class="filter wide">
        <input type="search" class="form-control" placeholder="Search code, name or description" aria-label="Search parameters"
               [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
      </div>
    </div>
    <div class="table-responsive">
      <!-- Fixed columns so the table fits the screen: the description wraps in what is left. -->
      <table class="table table-zed table-bordered param-table">
        <colgroup>
          <col style="width: 110px" />
          <col style="width: 20%" />
          <col />
          <col style="width: 170px" />
          <col style="width: 250px" />
        </colgroup>
        <thead>
          <tr>
            <th class="text-center">Parameter Code</th>
            <th class="text-center">Parameter Name</th>
            <th>Description</th>
            <th class="text-center">NIC Sectors</th>
            <th class="text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (s of pager.page(); track s.id) {
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
              <td class="text-center">
                @if (s.nicSectors?.length) {
                  @for (c of s.nicSectors; track c) { <span class="zed-chip" [title]="sectorName(c)">{{ c }}</span> }
                } @else {
                  <span class="muted">All sectors</span>
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
            <tr><td colspan="5" style="padding: 0"><div class="no-data">{{ pager.search() ? 'No parameter matches the search' : 'No Data' }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />

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
                  <label for="edit-nicSectors" class="top">NIC Sectors</label>
                  <div>
                    <zed-multi-select inputId="edit-nicSectors" label="NIC Sectors" [options]="sectorOptions()" [(value)]="e.nicSectors" />
                    <small class="muted d-block mt-1">None chosen: every sector.</small>
                  </div>
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
    .param-table { table-layout: fixed; width: 100%; min-width: 900px; }
    .page-head { align-items: flex-end; }
    .level-pick { display: flex; align-items: center; gap: 8px; }
    .level-pick .form-select { min-width: 220px; }
    .param-table td { vertical-align: middle; overflow-wrap: anywhere; }
    pre { color: #333; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; background-color: transparent; font-family: inherit; margin: 0; }
  `,
})
export class ParametersPage {
  private readonly api = inject(MastersApi);
  private readonly legacyUrl = signal('');

  private readonly router = inject(Router);

  /** The level's code (Bronze, Silver, Gold, ZEDX, ...); the page reloads when the menu or the level box switches level. */
  protected readonly sectionType = signal('Bronze');
  protected readonly levels = signal<ParameterLevel[]>([]);
  protected readonly levelName = computed(() => this.levels().find((l) => l.code.toLowerCase() === this.sectionType().toLowerCase())?.name ?? this.sectionType());
  protected readonly sectorOptions = signal<MultiSelectOption[]>([]);
  protected nicSectors: string[] = [];
  protected readonly pager = new ClientPager<Parameter>(10);
  protected readonly editing = signal<{ id: number; sectionName: string; description: string; nicSectors: string[] } | null>(null);
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
    firstValueFrom(this.api.parameterLevels()).then((l) => this.levels.set(l)).catch(() => undefined);
    firstValueFrom(this.api.list('sectors'))
      .then((list) => this.sectorOptions.set(list.map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` }))))
      .catch(() => undefined);
    inject(ActivatedRoute).paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.sectionType.set(params.get('sectionType') ?? 'Bronze');
      this.editing.set(null);
      this.success.set('');
      this.error.set('');
      this.pager.setSearch('');
      void this.load(true);
    });
  }

  protected pickLevel(code: string): void {
    void this.router.navigate(['/staff/masters/parameters', code]);
  }

  protected sectorName(code: string): string {
    return this.sectorOptions().find((o) => o.value === code)?.label ?? code;
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

  /** <paramref name="fresh"/>: another level, so page 1; otherwise (after a save) the same page. */
  private async load(fresh = false): Promise<void> {
    try {
      const rows = await firstValueFrom(this.api.parameters(this.sectionType()));
      if (fresh) this.pager.set(rows);
      else this.pager.refresh(rows);
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
      this.success.set((await firstValueFrom(this.api.addParameter(this.sectionType(), this.code.trim(), this.name.trim(), this.description, this.nicSectors))).message);
      this.code = this.name = this.description = '';
      this.nicSectors = [];
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
    this.editing.set({ id: p.id, sectionName: p.sectionName, description: p.description ?? '', nicSectors: [...(p.nicSectors ?? [])] });
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
      this.success.set((await firstValueFrom(this.api.updateParameter(this.sectionType(), e.id, e.sectionName.trim(), e.description, e.nicSectors))).message);
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
