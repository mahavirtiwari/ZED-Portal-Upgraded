import { Component, computed, inject, input, output } from '@angular/core';
import { GENDERS, SIZES, STATES } from './dashboard-filters';
import { HANDHOLDING_LEVEL_CODES, levelOptions } from '../../msme/shared/levels';
import { STAFF_SYSTEM } from '../staff-menu';
import { ListFilter } from './dashboard.api';
import { TextPipe } from '../../content/page-text';

/**
 * State / Certification Level / MSME Size / Gender drop-downs of the list pages, as one filter-bar; the page's own
 * filters (a search box) are projected into the same bar as `<div class="filter">` children.
 */
@Component({
  selector: 'zed-list-filters',
  imports: [TextPipe],
  template: `
    <div class="filter-bar">
      <div class="filter">
        <label class="form-label" for="f-state">{{ 'State' | t: 'staff.listFilters.stateLabel' }}</label>
        <select class="form-select" id="f-state" (change)="set('state', $event)">
          <option value="">{{ 'Show All' | t: 'staff.listFilters.showAll' }}</option>
          @for (s of states; track s.value) { <option [value]="s.value" [selected]="filter().state === s.value">{{ s.label }}</option> }
        </select>
      </div>
      <div class="filter">
        <label class="form-label" for="f-cert">{{ consultancy ? ('Level' | t: 'staff.listFilters.consultancy.levelLabel') : ('Certification Level' | t: 'staff.listFilters.levelLabel') }}</label>
        <select class="form-select" id="f-cert" (change)="set('certification', $event)">
          <option value="">{{ 'Show All' | t: 'staff.listFilters.showAll' }}</option>
          @for (c of certifications(); track c.value) { <option [value]="c.value" [selected]="filter().certification === c.value">{{ c.label }}</option> }
        </select>
      </div>
      <div class="filter">
        <label class="form-label" for="f-size">{{ 'MSME Size' | t: 'staff.listFilters.sizeLabel' }}</label>
        <select class="form-select" id="f-size" (change)="set('size', $event)">
          <option value="">{{ 'Show All' | t: 'staff.listFilters.showAll' }}</option>
          @for (s of sizes; track s) { <option [value]="s" [selected]="filter().size === s">{{ s }}</option> }
        </select>
      </div>
      <div class="filter">
        <label class="form-label" for="f-gender">{{ 'Gender' | t: 'staff.listFilters.genderLabel' }}</label>
        <select class="form-select" id="f-gender" (change)="set('gender', $event)">
          <option value="">{{ 'Show All' | t: 'staff.listFilters.showAll' }}</option>
          @for (g of genders; track g.value) { <option [value]="g.value" [selected]="filter().gender === g.value">{{ g.label }}</option> }
        </select>
      </div>
      <ng-content />
    </div>
  `,
})
export class ListFiltersBar {
  readonly filter = input.required<ListFilter>();
  readonly filterChange = output<ListFilter>();

  protected readonly states = STATES;
  /** 2026-11-21 (UI audit): Consultancy offers the handholding levels only (Silver, Gold, ZED-X), named "Level". */
  protected readonly consultancy = inject(STAFF_SYSTEM) === 'consultancy';
  /** Every level, the Admin's too (Administration → Certification Levels, 2026-11-08); Consultancy: the handholding levels. */
  protected readonly certifications = computed(() =>
    levelOptions().filter((o) => !this.consultancy || HANDHOLDING_LEVEL_CODES.some((c) => c.toLowerCase() === o.value.toLowerCase())));
  protected readonly sizes = SIZES;
  protected readonly genders = GENDERS;

  protected set(key: keyof ListFilter, event: Event): void {
    this.filterChange.emit({ ...this.filter(), [key]: (event.target as HTMLSelectElement).value });
  }
}
