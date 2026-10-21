import { Component, input, output } from '@angular/core';
import { CERTIFICATIONS, ClientPager, GENDERS, SIZES, STATES } from './dashboard-filters';
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

/** "Show N Entries" and First / Prev / page / Next / Last of the client-paged lists. */
@Component({
  selector: 'zed-pager-bar',
  template: `
    <div class="row justify-content-between mb-4">
      <div class="col-sm-6">
        Show
        <select class="btn btn-primary" aria-label="Entries per page" (change)="pager().setPageSize($any($event.target).value)">
          @for (n of sizes; track n) { <option [value]="n" [selected]="n === pager().pageSize()">{{ n }}</option> }
        </select>
        Entries
        <span class="ms-2 text-muted">({{ pager().filtered().length }} records)</span>
      </div>
      <div class="col-sm-auto">
        <button type="button" class="btn btn-primary me-1" (click)="pager().go(-2)">First</button>
        <button type="button" class="btn btn-primary me-1" (click)="pager().go(-1)">Prev</button>
        <select class="btn btn-primary me-1" aria-label="Page" (change)="pager().goTo($any($event.target).value)">
          @for (p of pager().pages(); track p) { <option [value]="p" [selected]="p === pager().pageNo()">{{ p }}</option> }
        </select>
        <button type="button" class="btn btn-primary me-1" (click)="pager().go(1)">Next</button>
        <button type="button" class="btn btn-primary" (click)="pager().go(2)">Last</button>
      </div>
    </div>
  `,
})
export class PagerBar {
  readonly pager = input.required<ClientPager>();
  protected readonly sizes = [10, 20, 50, 100];
}
