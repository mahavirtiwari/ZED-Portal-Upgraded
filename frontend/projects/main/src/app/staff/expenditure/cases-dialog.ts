import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { AdminPortal } from '../admin-portal';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import { ExpenditureApi, ExpenditureCase, ExpenditureFilter, caseText, rupees, shownDate } from './expenditure.api';

/** The "Cases" pop-up of an Expenditure row: each counted case with the date it counted and its frozen rate (Excel export). */
@Component({
  selector: 'zed-expenditure-cases',
  styleUrl: './exp-dialog.scss',
  template: `
    <div class="xd-back" (click)="closed.emit()"></div>
    <div class="xd wide" role="dialog" aria-modal="true" aria-labelledby="xc-title">
      <div class="xd-head">
        <span class="xd-ico" aria-hidden="true">#</span>
        <div><h3 id="xc-title">Cases · {{ title() }}</h3><small>{{ subtitle() }}</small></div>
        <button type="button" class="xd-x" aria-label="Close" (click)="closed.emit()">×</button>
      </div>
      <div class="xd-body">
        @if (error()) { <div class="alert alert-danger xd-err" role="alert">{{ error() }}</div> }
        @if (rows() === null) {
          <p role="status">Loading…</p>
        } @else {
          <div class="table-responsive">
            <table class="table table-zed">
              <thead><tr><th>ZED ID</th><th>Unit</th><th>State</th><th>Case</th><th>Counted on</th><th class="num">Rate</th></tr></thead>
              <tbody>
                @for (c of rows(); track $index) {
                  <tr>
                    <td>{{ c.zedId }}</td><td>{{ c.unitName || '—' }}</td><td>{{ c.state || '—' }}</td>
                    <td>{{ caseText(c) }}</td><td>{{ date(c.countedOn) }}</td><td class="num">{{ money(c.rate) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="6"><div class="no-data">No case counted in this period.</div></td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (rows()!.length >= 2000) { <p class="xd-note">The latest 2,000 cases are shown.</p> }
        }
      </div>
      <div class="xd-foot">
        <button type="button" class="btn btn-outline-primary" [disabled]="!rows()?.length" (click)="export()">Export</button>
        <button type="button" class="btn btn-default" (click)="closed.emit()">Close</button>
      </div>
    </div>
  `,
})
export class ExpenditureCasesDialog implements OnInit {
  private readonly api = inject(ExpenditureApi);
  private readonly excel = inject(TableExport);
  private readonly toast = inject(ToastService);

  readonly filter = input.required<ExpenditureFilter>();
  readonly portal = input<AdminPortal | null>(null);
  readonly title = input('');
  readonly subtitle = input('');
  readonly closed = output<void>();

  protected readonly rows = signal<ExpenditureCase[] | null>(null);
  protected readonly error = signal('');
  protected readonly money = rupees;
  protected readonly date = shownDate;

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.rows.set(await firstValueFrom(this.api.cases(this.filter(), this.portal())));
    } catch (e) {
      this.error.set(apiErrorMessage(e));
      this.rows.set([]);
    }
  }

  protected readonly caseText = caseText;

  protected async export(): Promise<void> {
    const rows = this.rows() ?? [];
    try {
      await this.excel.xlsx(`expenditure-cases-${this.filter().partyId ?? ''}-${this.filter().level ?? ''}`, [{
        name: 'Cases',
        columns: ['ZED ID', 'Unit', 'State', 'Level', 'Case', 'Counted on', 'Rate (₹, excl. GST)'],
        rows: rows.map((c) => [c.zedId, c.unitName, c.state, c.level, this.caseText(c), c.countedOn, c.rate]),
      }]);
    } catch (e) {
      this.toast.error('Export failed', apiErrorMessage(e));
    }
  }
}
