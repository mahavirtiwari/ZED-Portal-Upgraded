import { Component, input, output } from '@angular/core';
import { CERTIFICATIONS, GENDERS, SIZES, STATES } from './dashboard-filters';
import { ListFilter } from './dashboard.api';

/** State / Certification Level / MSME Size / Gender drop-downs of the list pages. */
@Component({
  selector: 'zed-list-filters',
  template: `
    <div class="d-flex flex-wrap gap-2">
      <div>
        <label for="f-state"><strong>State</strong></label>
        <select class="form-select" style="width: 200px" id="f-state" (change)="set('state', $event)">
          <option value="">Show All</option>
          @for (s of states; track s.value) { <option [value]="s.value" [selected]="filter().state === s.value">{{ s.label }}</option> }
        </select>
      </div>
      <div>
        <label for="f-cert"><strong>Certification Level</strong></label>
        <select class="form-select" style="width: 200px" id="f-cert" (change)="set('certification', $event)">
          <option value="">Show All</option>
          @for (c of certifications; track c) { <option [value]="c" [selected]="filter().certification === c">{{ c }}</option> }
        </select>
      </div>
      <div>
        <label for="f-size"><strong>MSME Size</strong></label>
        <select class="form-select" style="width: 200px" id="f-size" (change)="set('size', $event)">
          <option value="">Show All</option>
          @for (s of sizes; track s) { <option [value]="s" [selected]="filter().size === s">{{ s }}</option> }
        </select>
      </div>
      <div>
        <label for="f-gender"><strong>Gender</strong></label>
        <select class="form-select" style="width: 200px" id="f-gender" (change)="set('gender', $event)">
          <option value="">Show All</option>
          @for (g of genders; track g.value) { <option [value]="g.value" [selected]="filter().gender === g.value">{{ g.label }}</option> }
        </select>
      </div>
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
