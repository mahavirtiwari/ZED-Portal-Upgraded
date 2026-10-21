import { Component, input } from '@angular/core';
import { ClientPager, PAGE_SIZES } from './assessment-shared';

/** "Show N Entries" and First/Prev/page/Next/Last of the old list pages. */
@Component({
  selector: 'zed-list-pager',
  template: `
    @let p = pager();
    <div class="row justify-content-between mt-2">
      <div class="col-sm-6">
        Show
        <select class="btn btn-primary" aria-label="Entries per page" [value]="p.pageSize()" (change)="p.setPageSize($any($event.target).value)">
          @for (s of sizes; track s) {
            <option [value]="s" [selected]="s === p.pageSize()">{{ s }}</option>
          }
        </select>
        Entries
      </div>
      <div class="col-sm-5 text-end">
        <button type="button" class="btn btn-primary me-1" (click)="p.go('first')">First</button>
        <button type="button" class="btn btn-primary me-1" (click)="p.go('prev')">Prev</button>
        <select class="btn btn-primary me-1" aria-label="Page" (change)="p.go(+$any($event.target).value)">
          @for (i of p.pages(); track i) {
            <option [value]="i" [selected]="i === p.pageNo()">{{ i }}</option>
          }
        </select>
        <button type="button" class="btn btn-primary me-1" (click)="p.go('next')">Next</button>
        <button type="button" class="btn btn-primary" (click)="p.go('last')">Last</button>
      </div>
    </div>
  `,
})
export class ListPager {
  readonly pager = input.required<ClientPager>();
  protected readonly sizes = PAGE_SIZES;
}
