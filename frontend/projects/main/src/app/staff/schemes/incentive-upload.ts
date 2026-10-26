import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DatePipe } from '@angular/common';
import { IncentivesApi, RowError, SkippedRow } from './incentives.api';

export const MAX_INCENTIVE_FILE_BYTES = 5 * 1024 * 1024;

const COLUMNS = [
  'UdyamNo', 'Certificateno', 'Pin', 'ApplicationId', 'UnitName', 'District', 'FCI', 'ServiceName', 'ApprovalId',
  'IncentiveName', 'DisbursedAmount', 'DisbursedDate', 'DateOfProduction', 'AppliedDate', 'ApprovedDate',
];

/**
 * "Upload API Incentives" for the master admin. Port of Views/Incentive/UploadIncentives.cshtml. The
 * workbook (.xlsx, first sheet, 15 named columns) is checked completely on the server; rows are saved only
 * when every row is valid, otherwise the errors are listed by row and column. Rows uploaded before are
 * skipped and listed, so a file can be uploaded again after a partial failure.
 */
@Component({
  selector: 'zed-staff-incentive-upload',
  imports: [DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Incentives Upload</h3>
        <p class="page-sub">Upload the API incentives workbook; every row is checked before anything is saved.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-outline-primary" href="/api/staff/schemes/incentives/template">Download Template</a>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert"><strong>{{ error() }}</strong></div>
    }
    @if (success()) {
      <div class="alert" [class.alert-success]="rows().length" [class.alert-info]="!rows().length" role="status">
        <strong>{{ success() }}</strong>
      </div>
    }
    @if (skipped().length) {
      <div class="zed-card" id="skippedRows">
        <p class="mb-2">These rows were uploaded before (same unit, application, approval, incentive, date and amount) and were not saved again:</p>
        <div class="table-responsive mb-0">
          <table class="table table-zed table-bordered table-sm">
            <thead><tr><th class="text-center">Row</th><th class="text-center">Udyam No</th><th class="text-center">First uploaded</th></tr></thead>
            <tbody>
              @for (s of skipped(); track s.row) {
                <tr><td class="text-center">{{ s.row }}</td><td class="text-center">{{ s.udyamNo }}</td><td class="text-center">{{ s.uploadedOn ? (s.uploadedOn | date: 'dd-MM-yyyy') : '' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
    @if (rowErrors().length) {
      <div class="table-responsive">
        <table class="table table-zed table-bordered table-sm">
          <thead><tr><th class="text-center" style="width: 80px">Row</th><th class="text-center">Column</th><th>Problem</th></tr></thead>
          <tbody>
            @for (e of rowErrors(); track $index) {
              <tr class="table-danger"><td class="text-center">{{ e.row || '' }}</td><td class="text-center">{{ e.column }}</td><td>{{ e.message }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
    @if (!rows().length) {
      <div class="zed-card">
        <p class="muted">Excel workbook (.xlsx) with the columns: {{ columns.join(', ') }}. Dates as dd-mm-yyyy or Excel dates. Up to 5000 rows, 5 MB.</p>
        <div class="form-grid">
          <label for="incFile">Incentives Excel File:<span class="req">*</span></label>
          <input id="incFile" type="file" class="form-control" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="pick($event)" />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="upload()">Upload</button>
        </div>
      </div>
    } @else {
      <div class="table-responsive uploaded">
        <table class="table table-zed table-bordered table-hover">
          <thead>
            <tr>
              <th class="text-center">S.No</th>
              @for (c of columns; track c) { <th class="text-center">{{ c }}</th> }
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track $index) {
              <tr>
                <td class="text-center">{{ $index + 1 }}</td>
                @for (c of columns; track c) { <td>{{ show(c, r[c]) }}</td> }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-default" (click)="reset()">Upload another file</button>
      </div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .uploaded td { font-size: 13px; white-space: nowrap; }
  `,
})
export class IncentiveUploadPage {
  private readonly api = inject(IncentivesApi);
  protected readonly columns = COLUMNS;
  protected readonly file = signal<File | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly rowErrors = signal<RowError[]>([]);
  protected readonly rows = signal<Record<string, string | null>[]>([]);
  protected readonly skipped = signal<SkippedRow[]>([]);

  protected pick(event: Event): void {
    const f = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.error.set('');
    if (f && (!/\.xlsx$/i.test(f.name) || f.size > MAX_INCENTIVE_FILE_BYTES)) {
      this.error.set('Upload valid excel file (accepted format: .xlsx, up to 5 MB).');
      this.file.set(null);
      return;
    }
    this.file.set(f);
  }

  protected async upload(): Promise<void> {
    const f = this.file();
    this.success.set('');
    this.rowErrors.set([]);
    this.skipped.set([]);
    if (!f) {
      this.error.set('Please choose the incentives Excel file.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.api.upload(f));
      this.success.set(r.inserted ? `${r.message} (${r.inserted} rows)` : r.message);
      this.rows.set(r.rows ?? []);
      this.skipped.set(r.skipped ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      const details = err instanceof HttpErrorResponse ? (err.error as { rowErrors?: RowError[] } | null)?.rowErrors : undefined;
      this.rowErrors.set(details ?? []);
    } finally {
      this.busy.set(false);
    }
  }

  protected reset(): void {
    this.rows.set([]);
    this.skipped.set([]);
    this.success.set('');
    this.file.set(null);
  }

  /** Dates are sent back as yyyyMMdd. */
  protected show(column: string, v: string | null | undefined): string {
    if (!v) return '';
    const m = column.includes('Date') ? /^(\d{4})(\d{2})(\d{2})$/.exec(v) : null;
    return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
  }
}
