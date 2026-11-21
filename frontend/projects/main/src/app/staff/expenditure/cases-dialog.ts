import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { AdminPortal } from '../admin-portal';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import { ExpenditureApi, ExpenditureCase, ExpenditureFilter, caseText, rupees, shownDate } from './expenditure.api';
import { TextPipe, t } from '../../content/page-text';

/** The "Cases" pop-up of an Expenditure row: each counted case with the date it counted and its frozen rate (Excel export). */
@Component({
  selector: 'zed-expenditure-cases',
  imports: [TextPipe],
  styleUrl: './exp-dialog.scss',
  template: `
    <div class="xd-back" (click)="closed.emit()"></div>
    <div class="xd wide" role="dialog" aria-modal="true" aria-labelledby="xc-title">
      <div class="xd-head">
        <span class="xd-ico" aria-hidden="true">#</span>
        <div><h3 id="xc-title">{{ 'Cases · {title}' | t: 'staff.expenditure.cases.title' : { title: title() } }}</h3><small>{{ subtitle() }}</small></div>
        <button type="button" class="xd-x" data-dismiss [attr.aria-label]="'Close' | t: 'staff.expenditure.cases.closeAria'" (click)="closed.emit()">×</button>
      </div>
      <div class="xd-body">
        @if (error()) { <div class="alert alert-danger xd-err" role="alert">{{ error() }}</div> }
        @if (rows() === null) {
          <p role="status">{{ 'Loading…' | t: 'staff.expenditure.cases.loadingText' }}</p>
        } @else {
          <div class="table-responsive">
            <table class="table table-zed">
              <thead><tr><th>{{ 'ZED ID' | t: 'staff.expenditure.cases.column.zedId' }}</th><th>{{ 'Unit' | t: 'staff.expenditure.cases.column.unit' }}</th><th>{{ 'State' | t: 'staff.expenditure.cases.column.state' }}</th><th>{{ 'Case' | t: 'staff.expenditure.cases.column.case' }}</th><th>{{ 'Counted on' | t: 'staff.expenditure.cases.column.countedOn' }}</th><th class="num">{{ 'Rate' | t: 'staff.expenditure.cases.column.rate' }}</th></tr></thead>
              <tbody>
                @for (c of rows(); track $index) {
                  <tr>
                    <td class="nowrap">{{ c.zedId }}</td><td>{{ c.unitName || '—' }}</td><td>{{ c.state || '—' }}</td>
                    <td>{{ caseText(c) }}</td><td class="nowrap">{{ date(c.countedOn) }}</td><td class="num">{{ money(c.rate) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="6"><div class="no-data">{{ 'No case counted in this period.' | t: 'staff.expenditure.cases.empty' }}</div></td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (rows()!.length >= 2000) { <p class="xd-note">{{ 'The latest 2,000 cases are shown.' | t: 'staff.expenditure.cases.limitNote' }}</p> }
        }
      </div>
      <div class="xd-foot">
        <button type="button" class="btn btn-outline-primary" [disabled]="!rows()?.length" (click)="export()">{{ 'Export' | t: 'staff.expenditure.cases.exportButton' }}</button>
        <button type="button" class="btn btn-default" (click)="closed.emit()">{{ 'Close' | t: 'staff.expenditure.cases.closeButton' }}</button>
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
        columns: [
          t('staff.expenditure.cases.export.column.zedId', 'ZED ID'), t('staff.expenditure.cases.export.column.unit', 'Unit'),
          t('staff.expenditure.cases.export.column.state', 'State'), t('staff.expenditure.cases.export.column.level', 'Level'),
          t('staff.expenditure.cases.export.column.case', 'Case'), t('staff.expenditure.cases.export.column.countedOn', 'Counted on'),
          t('staff.expenditure.cases.export.column.rate', 'Rate (₹, excl. GST)'),
        ],
        rows: rows.map((c) => [c.zedId, c.unitName, c.state, c.level, this.caseText(c), c.countedOn, c.rate]),
      }]);
    } catch (e) {
      this.toast.error(t('staff.expenditure.cases.toast.exportFailed', 'Export failed'), apiErrorMessage(e));
    }
  }
}
