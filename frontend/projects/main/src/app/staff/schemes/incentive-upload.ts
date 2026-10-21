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
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-3">
        <div class="col-sm-12">
          <div class="card card-info mb-3">
            <div class="card-header d-flex justify-content-between align-items-center">
              <strong class="panel-title">Incentives Upload</strong>
              <a class="btn btn-success btn-sm" href="/api/staff/schemes/incentives/template">Download Template</a>
            </div>
            <div class="card-body">
              @if (error()) {
                <div class="alert alert-danger" role="alert"><strong>{{ error() }}</strong></div>
              }
              @if (success()) {
                <div class="alert" [class.alert-success]="rows().length" [class.alert-info]="!rows().length" role="status">
                  <strong>{{ success() }}</strong>
                </div>
              }
              @if (skipped().length) {
                <div class="table-responsive mb-3" id="skippedRows">
                  <p class="mb-1">These rows were uploaded before (same unit, application, approval, incentive, date and amount) and were not saved again:</p>
                  <table class="table table-bordered table-sm">
                    <thead><tr><th>Row</th><th>Udyam No</th><th>First uploaded</th></tr></thead>
                    <tbody>
                      @for (s of skipped(); track s.row) {
                        <tr><td>{{ s.row }}</td><td>{{ s.udyamNo }}</td><td>{{ s.uploadedOn ? (s.uploadedOn | date: 'dd-MM-yyyy') : '' }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              @if (rowErrors().length) {
                <div class="table-responsive mb-3">
                  <table class="table table-bordered table-sm">
                    <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
                    <tbody>
                      @for (e of rowErrors(); track $index) {
                        <tr><td>{{ e.row || '' }}</td><td>{{ e.column }}</td><td>{{ e.message }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              @if (!rows().length) {
                <p class="text-muted">Excel workbook (.xlsx) with the columns: {{ columns.join(', ') }}. Dates as dd-mm-yyyy or Excel dates. Up to 5000 rows, 5 MB.</p>
                <div class="d-sm-flex justify-content-between align-items-center gap-2">
                  <label for="incFile" class="control-label">Incentives Excel File:<span style="color: red">*</span></label>
                  <input id="incFile" type="file" class="form-control" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="pick($event)" />
                  <button type="button" class="btn btn-primary btn-lg" [disabled]="busy()" (click)="upload()">Upload</button>
                </div>
              } @else {
                <div class="table-responsive" style="font-size: smaller; min-height: 250px">
                  <table class="table table-hover table-striped table-bordered">
                    <thead>
                      <tr style="color: white; background-color: #0091e0">
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
                <button type="button" class="btn btn-default" (click)="reset()">Upload another file</button>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
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
