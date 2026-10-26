import { Component, input, output } from '@angular/core';
import { CERTIFICATIONS, GENDERS, SIZES, STATES } from './dashboard-filters';
import { ListFilter } from './dashboard.api';

/**
 * State / Certification Level / MSME Size / Gender drop-downs of the list pages, as one filter-bar; the page's own
 * filters (a search box) are projected into the same bar as `<div class="filter">` children.
 */
@Component({
  selector: 'zed-list-filters',
  template: `
    <div class="filter-bar">
      <div class="filter">
        <label class="form-label" for="f-state">State</label>
        <select class="form-select" id="f-state" (change)="set('state', $event)">
          <option value="">Show All</option>
          @for (s of states; track s.value) { <option [value]="s.value" [selected]="filter().state === s.value">{{ s.label }}</option> }
        </select>
      </div>
      <div class="filter">
        <label class="form-label" for="f-cert">Certification Level</label>
        <select class="form-select" id="f-cert" (change)="set('certification', $event)">
          <option value="">Show All</option>
          @for (c of certifications; track c) { <option [value]="c" [selected]="filter().certification === c">{{ c }}</option> }
        </select>
      </div>
      <div class="filter">
        <label class="form-label" for="f-size">MSME Size</label>
        <select class="form-select" id="f-size" (change)="set('size', $event)">
          <option value="">Show All</option>
          @for (s of sizes; track s) { <option [value]="s" [selected]="filter().size === s">{{ s }}</option> }
        </select>
      </div>
      <div class="filter">
        <label class="form-label" for="f-gender">Gender</label>
        <select class="form-select" id="f-gender" (change)="set('gender', $event)">
          <option value="">Show All</option>
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
  protected readonly certifications = CERTIFICATIONS;
  protected readonly sizes = SIZES;
  protected readonly genders = GENDERS;

  protected set(key: keyof ListFilter, event: Event): void {
    this.filterChange.emit({ ...this.filter(), [key]: (event.target as HTMLSelectElement).value });
  }
}
