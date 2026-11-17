import { HttpClient } from '@angular/common/http';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { SkippedRow } from './incentives.api';
import { PageHead } from '../../msme/shared/page-head';
import { StepTracker, TrackerStep } from '../../msme/shared/step-tracker';
import { staffCrumbs } from '../staff-crumbs';
import { PagedView, PagerComponent } from '../pager';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';

export const MAX_INCENTIVE_FILE_BYTES = 5 * 1024 * 1024;
export const INCENTIVE_CHECK_API = '/api/staff/schemes/incentives/upload/check';
export const INCENTIVE_APPLY_API = '/api/staff/schemes/incentives/upload/apply';

const COLUMNS = [
  'UdyamNo', 'Certificateno', 'Pin', 'ApplicationId', 'UnitName', 'District', 'FCI', 'ServiceName', 'ApprovalId',
  'IncentiveName', 'DisbursedAmount', 'DisbursedDate', 'DateOfProduction', 'AppliedDate', 'ApprovedDate',
];

/** An error of a cell (column "" = the row), with the cell as written. */
export interface CellError {
  row: number;
  column: string;
  message: string;
  value: string | null;
}

/** POST upload/check: nothing is saved. */
export interface IncentiveCheck {
  fileName: string;
  total: number;
  /** Ready to save (valid and not uploaded before). */
  valid: number;
  alreadyUploaded: number;
  invalid: number;
  errors: CellError[];
  errorCount: number;
  rejected: { row: number; cells: (string | null)[]; problems: string }[];
  skipped: SkippedRow[];
  columns: string[];
}

/** POST upload/apply: the valid rows saved. */
export interface IncentiveApplied {
  message: string;
  inserted: number;
  rows: Record<string, string | null>[];
  skipped?: SkippedRow[];
  rejected?: number;
}

/**
 * "Upload API Incentives" for the master admin. Port of Views/Incentive/UploadIncentives.cshtml. The
 * workbook (.xlsx, first sheet, 15 named columns) is checked on the server. Rows uploaded before are
 * skipped and listed, so a file can be uploaded again after a partial failure.
 * <p>2026-11-17 (approved redesign and behaviour): a drop zone and a three-step tracker (upload, check, save). "Upload and
 * check" only checks the file (upload/check) and opens the check results: rows read, rows ready to save, rows with errors
 * (row, column, value, problem) and a CSV of the rejected rows. "Save N valid rows" sends the same file to upload/apply,
 * which checks it again and saves only its valid rows. The design's "Recent uploads" is not shown: no upload log is kept.</p>
 */
@Component({
  selector: 'zed-staff-incentive-upload',
  imports: [DatePipe, DecimalPipe, PageHead, StepTracker, PagerComponent],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" title="Incentives Upload" subtitle="Upload the API incentives workbook; every row is checked before anything is saved.">
      <a class="btn btn-outline-primary" href="/api/staff/schemes/incentives/template">Download template</a>
    </zed-page-head>
    @if (error()) {
      <div class="alert alert-danger" role="alert"><strong>{{ error() }}</strong></div>
    }
    <div class="iu-grid">
      <div class="iu-main">
        <zed-step-tracker [steps]="steps" [current]="step()" label="Upload steps" />
        @if (!saved()) {
          <div class="zed-card iu-card">
            <label class="iu-drop" for="incFile" [class.over]="dragging()" (dragover)="over($event)" (dragleave)="dragging.set(false)" (drop)="drop($event)">
              <input id="incFile" type="file" class="visually-hidden" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="pick($event)" />
              <span class="iu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg></span>
              @if (file(); as f) {
                <b>{{ f.name }}</b><small>{{ f.size / 1024 | number: '1.0-0' }} KB · choose another file or drop it here</small>
              } @else {
                <b>Drag the Excel workbook here, or browse</b><small>.xlsx only · up to 5,000 rows · 5 MB</small>
              }
            </label>
            <div class="iu-foot">
              <span class="sub">Nothing is saved until you confirm the check results.</span>
              <button type="button" class="btn btn-primary" [disabled]="busy() || !file()" (click)="check()">{{ busy() ? 'Checking…' : 'Upload and check' }}</button>
            </div>
          </div>
        } @else {
          @let s = saved()!;
          <div class="zed-card iu-card" id="savedResult">
            <div class="alert mb-3" [class.alert-success]="s.inserted" [class.alert-info]="!s.inserted" role="status"><strong>{{ s.message }}</strong></div>
            @if (skippedRows().length) {
              <div id="skippedRows">
                <p class="mb-2">These rows were uploaded before (same unit, application, approval, incentive, date and amount) and were not saved again:</p>
                <div class="table-responsive mb-3">
                  <table class="table table-zed table-sm">
                    <thead><tr><th>Row</th><th>Udyam No</th><th>First uploaded</th></tr></thead>
                    <tbody>
                      @for (s of skippedRows(); track s.row) {
                        <tr><td>{{ s.row }}</td><td>{{ s.udyamNo }}</td><td>{{ s.uploadedOn ? (s.uploadedOn | date: 'dd-MM-yyyy') : '' }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
            @if (s.rows.length) {
              <div class="table-responsive uploaded mb-3">
                <table class="table table-zed table-sm">
                  <thead><tr><th>S.No</th>@for (c of columns; track c) { <th>{{ c }}</th> }</tr></thead>
                  <tbody>
                    @for (r of s.rows; track $index) {
                      <tr><td>{{ $index + 1 }}</td>@for (c of columns; track c) { <td>{{ show(c, r[c]) }}</td> }</tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            <button type="button" class="btn btn-default" (click)="reset()">Upload another file</button>
          </div>
        }
        <div class="zed-card iu-card">
          <h3 class="iu-h">Columns the workbook must have</h3>
          <div class="iu-cols">@for (c of columns; track c) { <span>{{ c }}</span> }</div>
          <p class="sub mb-0">Dates as dd-mm-yyyy or Excel dates.</p>
        </div>
      </div>
      <aside class="zed-card iu-card iu-side">
        <h3 class="iu-h">Before you upload</h3>
        <ul class="iu-tips">
          <li>Use the latest template; column names must match exactly.</li>
          <li>One incentive per row, with the unit's Udyam number.</li>
          <li>Amounts as numbers, without commas or the rupee sign.</li>
          <li>Rows with errors are not saved; rows uploaded before are skipped.</li>
        </ul>
      </aside>
    </div>

    @if (result(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="iuTitle">
        <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
          <div class="modal-content iu-pop">
            <div class="modal-header">
              <div class="w-100 d-flex justify-content-between align-items-start gap-2">
                <div><h3 class="registration-title m-0" id="iuTitle">Check results</h3><small class="sub">{{ c.fileName }} · checked {{ checkedAt() | date: 'dd MMM yyyy, HH:mm' }}</small></div>
                <button type="button" class="btn btn-link p-0 iu-x" aria-label="Close" (click)="cancel()">×</button>
              </div>
            </div>
            <div class="modal-body">
              <div class="iu-tiles">
                <div><b>{{ c.total | number }}</b>&ngsp;<span>Rows read</span></div>
                <div class="ok"><b>{{ c.valid | number }}</b>&ngsp;<span>Ready to save</span></div>
                <div class="bad"><b>{{ c.invalid | number }}</b>&ngsp;<span>Rows with errors</span></div>
              </div>
              @if (c.alreadyUploaded) {
                <p class="sub" id="alreadyUploaded">{{ c.alreadyUploaded | number }} row(s) were uploaded before and will be skipped.</p>
              }
              @if (c.errors.length) {
                <div class="iu-errhead">
                  <span>Rows with errors</span>
                  <button type="button" class="btn btn-link p-0" (click)="downloadRejected()">Download the {{ c.invalid | number }} rows (.csv)</button>
                </div>
                <div class="list-card">
                  <div class="table-responsive">
                    <table class="table table-zed">
                      <thead><tr><th>Row</th><th>Column</th><th>Value</th><th>Problem</th></tr></thead>
                      <tbody>
                        @for (e of errorsView.page(); track $index) {
                          <tr><td><b>{{ e.row || '' }}</b></td><td>{{ e.column || 'Whole row' }}</td><td class="sub">{{ e.value ?? 'blank' }}</td><td>{{ e.message }}</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <zed-pager [pager]="errorsView" />
                </div>
                @if (c.errorCount > c.errors.length) {
                  <p class="sub mt-2">The first {{ c.errors.length | number }} of {{ c.errorCount | number }} errors are listed; the download has every rejected row.</p>
                }
              }
              @if (applyError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ applyError() }}</div> }
            </div>
            <div class="modal-footer justify-content-between">
              <span class="sub">Nothing is saved until you confirm.</span>
              <div class="d-flex gap-2">
                <button type="button" class="btn btn-default" (click)="cancel()">Cancel upload</button>
                <button type="button" class="btn btn-primary" [disabled]="busy() || !c.valid" (click)="apply()">
                  {{ busy() ? 'Saving…' : 'Save ' + (c.valid | number) + ' valid row' + (c.valid === 1 ? '' : 's') }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .iu-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
    .iu-main { display: grid; gap: 16px; min-width: 0; }
    .iu-card { padding: 18px 20px; margin: 0; }
    .iu-drop { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 26px 16px; margin: 0; border: 2px dashed var(--zt-mid2, #2a8a8c);
      border-radius: 12px; background: #fbfdfd; text-align: center; cursor: pointer; }
    .iu-drop.over, .iu-drop:hover { background: color-mix(in srgb, var(--zt-soft, #d4ebe6) 40%, #fff); }
    .iu-drop:focus-within { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .iu-drop b { color: var(--zt-ink, #173f44); overflow-wrap: anywhere; }
    .iu-drop small { color: #5f6f70; }
    .iu-icon { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--zt-soft, #d4ebe6) 70%, #fff); }
    .iu-icon svg { width: 20px; height: 20px; fill: none; stroke: var(--zt-dark, #1f5c61); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .iu-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-top: 14px; }
    .iu-h { font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); margin: 0 0 12px; }
    .iu-cols { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .iu-cols span { padding: 4px 10px; border-radius: 6px; background: #eef4f4; color: var(--zt-ink, #173f44); font-size: 13px; }
    .iu-tips { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; font-size: 13.5px; }
    .iu-tips li { position: relative; padding-left: 26px; }
    .iu-tips li::before { content: '✓'; position: absolute; left: 0; top: 0; width: 18px; height: 18px; border-radius: 50%; background: #2e9e57; color: #fff;
      font-size: 11px; font-weight: 700; display: grid; place-items: center; }
    .sub { color: #5f6f70; font-size: 13px; }
    .uploaded td { font-size: 13px; white-space: nowrap; }
    .iu-pop { border-radius: 12px; }
    .iu-x { font-size: 24px; line-height: 1; color: #5f6f70 !important; text-decoration: none; }
    .iu-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
    .iu-tiles > div { border: 1px solid #dfe9ea; border-radius: 10px; padding: 12px 14px; background: #f7fbfb; }
    .iu-tiles .ok { background: #eaf6ee; border-color: #cfe8d7; }
    .iu-tiles .bad { background: #fdeeee; border-color: #f3d3d0; }
    .iu-tiles b { display: block; font-size: 22px; font-weight: 800; color: var(--zt-ink, #173f44); }
    .iu-tiles .ok b { color: #1e8a4c; }
    .iu-tiles .bad b { color: #c0392b; }
    .iu-tiles span { font-size: 13px; color: #5f6f70; }
    .iu-errhead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; margin: 6px 0 8px; font-size: 12px;
      font-weight: 800; letter-spacing: .5px; text-transform: uppercase; color: var(--zt-ink, #173f44); }
    .iu-errhead .btn-link { font-size: 13px; font-weight: 700; text-transform: none; letter-spacing: 0; }
    @media (max-width: 991.98px) { .iu-grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 575.98px) { .iu-tiles b { font-size: 18px; } .iu-tiles { gap: 8px; } }
  `,
})
export class IncentiveUploadPage {
  private readonly http = inject(HttpClient);
  private readonly exporter = inject(TableExport);
  private readonly toast = inject(ToastService);

  protected readonly crumbs = staffCrumbs({ label: 'Upload API Incentives' });
  protected readonly columns = COLUMNS;
  protected readonly steps: TrackerStep[] = [
    { label: 'Choose the workbook', note: 'Upload' },
    { label: 'Check every row', note: 'Errors listed by row' },
    { label: 'Save', note: 'Only valid rows' },
  ];
  protected readonly file = signal<File | null>(null);
  protected readonly dragging = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly applyError = signal('');
  protected readonly result = signal<IncentiveCheck | null>(null);
  protected readonly checkedAt = signal<Date>(new Date());
  protected readonly saved = signal<IncentiveApplied | null>(null);
  protected readonly skippedRows = computed(() => this.saved()?.skipped ?? []);
  protected readonly errorsView = new PagedView(() => this.result()?.errors ?? []);
  protected readonly step = computed(() => (this.saved() ? 3 : this.result() ? 1 : 0));

  protected pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.choose(input.files?.[0] ?? null);
    input.value = '';
  }

  protected over(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.choose(event.dataTransfer?.files?.[0] ?? null);
  }

  private choose(f: File | null): void {
    this.error.set('');
    if (f && (!/\.xlsx$/i.test(f.name) || f.size > MAX_INCENTIVE_FILE_BYTES)) {
      this.error.set('Upload valid excel file (accepted format: .xlsx, up to 5 MB).');
      this.file.set(null);
      return;
    }
    this.file.set(f);
  }

  /** Step 2: the server checks every row; nothing is saved. */
  protected async check(): Promise<void> {
    const f = this.file();
    if (!f) {
      this.error.set('Please choose the incentives Excel file.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.applyError.set('');
    try {
      const r = await firstValueFrom(this.http.post<IncentiveCheck>(INCENTIVE_CHECK_API, this.form(f)));
      this.checkedAt.set(new Date());
      this.result.set(r);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Step 3: the same file again; the server checks it again and saves the valid rows. */
  protected async apply(): Promise<void> {
    const f = this.file();
    if (!f || !this.result()?.valid) return;
    this.busy.set(true);
    this.applyError.set('');
    try {
      const r = await firstValueFrom(this.http.post<IncentiveApplied>(INCENTIVE_APPLY_API, this.form(f)));
      this.result.set(null);
      this.saved.set({ ...r, rows: r.rows ?? [] });
      if (r.inserted) this.toast.success('Incentives saved', r.message);
    } catch (err) {
      this.applyError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected cancel(): void {
    if (this.busy() || !this.result()) return;
    this.result.set(null);
    this.applyError.set('');
  }

  /** The rejected rows as written, with their problems, to correct and upload again. */
  protected downloadRejected(): void {
    const c = this.result();
    if (!c) return;
    const base = c.fileName.replace(/\.xlsx$/i, '') || 'incentives';
    this.exporter.csv(`${base}-rows-with-errors`, {
      name: 'Rows with errors',
      columns: ['Row', ...c.columns, 'Problems'],
      rows: c.rejected.map((r) => [r.row, ...r.cells, r.problems]),
    });
  }

  protected reset(): void {
    this.saved.set(null);
    this.result.set(null);
    this.file.set(null);
    this.error.set('');
  }

  /** Dates are sent back as yyyyMMdd. */
  protected show(column: string, v: string | null | undefined): string {
    if (!v) return '';
    const m = column.includes('Date') ? /^(\d{4})(\d{2})(\d{2})$/.exec(v) : null;
    return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
  }

  private form(f: File): FormData {
    const form = new FormData();
    form.append('file', f, f.name);
    return form;
  }
}
