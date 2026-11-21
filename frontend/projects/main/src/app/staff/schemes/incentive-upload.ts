import { HttpClient } from '@angular/common/http';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { SkippedRow } from './incentives.api';
import { PageHead } from '../../msme/shared/page-head';
import { StepTracker, TrackerStep } from '../../msme/shared/step-tracker';
import { staffCrumbs } from '../staff-crumbs';
import { PagedView, PagerComponent } from '../pager';
import { TableExport } from '../table-export';
import { blobErrorMessage } from '../excel-tools';
import { ToastService } from '../toast';

export const MAX_INCENTIVE_FILE_BYTES = 5 * 1024 * 1024;
export const INCENTIVE_CHECK_API = '/api/staff/schemes/incentives/upload/check';
export const INCENTIVE_APPLY_API = '/api/staff/schemes/incentives/upload/apply';
export const INCENTIVE_TEMPLATE_API = '/api/staff/schemes/incentives/template';

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
 * <p>2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-17 and staff-popup-10 — an 856px column and a 420px
 * rail, cards with a 30px icon tile and a divided head, grey column chips, the upload-tray icon, "You are here" under the current
 * step, the template button with its download icon; the check results 900px wide with a white head (icon tile, 32px close), the
 * three tiles, the errors table in its card and a divided footer. The rows with errors download as .xlsx (to correct and upload
 * again).</p>
 * <p>2026-11-19 ("All page wording"): every wording is the Admin's (Texts → Page wording, staff.incentiveUpload.*) or the standard
 * one here; the workbook's column names (and the Row / Problems columns of the download, read back on upload) stay as they are.</p>
 */
@Component({
  selector: 'zed-staff-incentive-upload',
  imports: [DatePipe, DecimalPipe, PageHead, StepTracker, PagerComponent, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="'Upload API Incentives' | t: 'staff.incentiveUpload.title'" [subtitle]="'Upload the API incentives workbook; every row is checked before anything is saved.' | t: 'staff.incentiveUpload.sub'">
      <button type="button" class="btn btn-outline-primary" id="templateButton" [disabled]="templateBusy()" (click)="downloadTemplate()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>{{ 'Download template' | t: 'staff.incentiveUpload.templateButton' }}</button>
    </zed-page-head>
    @if (error()) {
      <div class="alert alert-danger" role="alert"><strong>{{ error() }}</strong></div>
    }
    <div class="iu-grid">
      <div class="iu-main">
        <zed-step-tracker [steps]="steps()" [current]="step()" [label]="'Upload steps' | t: 'staff.incentiveUpload.steps.label'" />
        @if (!saved()) {
          <div class="zed-card iu-card">
            <label class="iu-drop" for="incFile" [class.over]="dragging()" (dragover)="over($event)" (dragleave)="dragging.set(false)" (drop)="drop($event)">
              <input id="incFile" type="file" class="visually-hidden" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="pick($event)" />
              <span class="iu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" /></svg></span>
              @if (file(); as f) {
                <b>{{ f.name }}</b><small>{{ '{size} KB · choose another file or drop it here' | t: 'staff.incentiveUpload.drop.chosenNote' : { size: (f.size / 1024 | number: '1.0-0') } }}</small>
              } @else {
                <b>{{ 'Drag the Excel workbook here, or browse' | t: 'staff.incentiveUpload.drop.title' }}</b><small>{{ '.xlsx only · up to 5,000 rows · 5 MB' | t: 'staff.incentiveUpload.drop.note' }}</small>
              }
            </label>
            <div class="iu-foot">
              <span class="sub">{{ 'Nothing is saved until you confirm the check results.' | t: 'staff.incentiveUpload.checkNote' }}</span>
              <button type="button" class="btn btn-primary" [disabled]="busy() || !file()" (click)="check()">{{ busy() ? ('Checking…' | t: 'staff.incentiveUpload.checkingButton') : ('Upload and check' | t: 'staff.incentiveUpload.checkButton') }}</button>
            </div>
          </div>
        } @else {
          @let s = saved()!;
          <div class="zed-card iu-card" id="savedResult">
            <div class="alert mb-3" [class.alert-success]="s.inserted" [class.alert-info]="!s.inserted" role="status"><strong>{{ s.message }}</strong></div>
            @if (skippedRows().length) {
              <div id="skippedRows">
                <p class="mb-2">{{ 'These rows were uploaded before (same unit, application, approval, incentive, date and amount) and were not saved again:' | t: 'staff.incentiveUpload.skipped.note' }}</p>
                <div class="table-responsive mb-3">
                  <table class="table table-zed table-sm">
                    <thead><tr><th>{{ 'Row' | t: 'staff.incentiveUpload.skipped.column.row' }}</th><th>{{ 'Udyam No' | t: 'staff.incentiveUpload.skipped.column.udyam' }}</th><th>{{ 'First uploaded' | t: 'staff.incentiveUpload.skipped.column.firstUploaded' }}</th></tr></thead>
                    <tbody>
                      @for (s of skippedRows(); track s.row) {
                        <tr><td>{{ s.row }}</td><td>{{ s.udyamNo }}</td><td>{{ s.uploadedOn ? (s.uploadedOn | date: 'dd MMM yyyy') : '' }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
            @if (s.rows.length) {
              <div class="table-responsive uploaded mb-3">
                <table class="table table-zed table-sm">
                  <thead><tr><th>{{ 'S.No' | t: 'staff.incentiveUpload.saved.column.serial' }}</th>@for (c of columns; track c) { <th>{{ c }}</th> }</tr></thead>
                  <tbody>
                    @for (r of s.rows; track $index) {
                      <tr><td>{{ $index + 1 }}</td>@for (c of columns; track c) { <td>{{ show(c, r[c]) }}</td> }</tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            <button type="button" class="btn btn-default" (click)="reset()">{{ 'Upload another file' | t: 'staff.incentiveUpload.saved.againButton' }}</button>
          </div>
        }
        <section class="zed-card iu-box" aria-labelledby="iu-cols-h">
          <h3 class="iu-h" id="iu-cols-h"><span class="iu-tile" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg></span>{{ 'Columns the workbook must have' | t: 'staff.incentiveUpload.columns.title' }}</h3>
          <div class="iu-body">
            <div class="iu-cols">@for (c of columns; track c) { <span>{{ c }}</span> }</div>
            <p class="sub mb-0">{{ 'Dates as dd-mm-yyyy or Excel dates.' | t: 'staff.incentiveUpload.columns.note' }}</p>
          </div>
        </section>
      </div>
      <aside class="zed-card iu-box iu-side" aria-labelledby="iu-tips-h">
        <h3 class="iu-h" id="iu-tips-h"><span class="iu-tile" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" /></svg></span>{{ 'Before you upload' | t: 'staff.incentiveUpload.tips.title' }}</h3>
        <ul class="iu-body iu-tips">
          <li>{{ 'Use the latest template; column names must match exactly.' | t: 'staff.incentiveUpload.tips.point1' }}</li>
          <li>{{ "One incentive per row, with the unit's Udyam number." | t: 'staff.incentiveUpload.tips.point2' }}</li>
          <li>{{ 'Amounts as numbers, without commas or the rupee sign.' | t: 'staff.incentiveUpload.tips.point3' }}</li>
        </ul>
      </aside>
    </div>

    @if (result(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="iuTitle">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable iu-dialog">
          <div class="modal-content iu-pop">
            <div class="iu-pop-head">
              <span class="iu-tile iu-tile-lg" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg></span>
              <div class="iu-pop-t"><h3 class="m-0" id="iuTitle">{{ 'Check results' | t: 'staff.incentiveUpload.result.title' }}</h3><small>{{ '{file} · uploaded {date}' | t: 'staff.incentiveUpload.result.fileNote' : { file: c.fileName, date: (checkedAt() | date: 'dd MMM yyyy, HH:mm') } }}</small></div>
              <button type="button" class="iu-x" [attr.aria-label]="'Close' | t: 'staff.incentiveUpload.result.closeAria'" (click)="cancel()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
            </div>
            <div class="modal-body">
              <div class="iu-tiles">
                <div><b>{{ c.total | number }}</b>&ngsp;<span>{{ 'Rows read' | t: 'staff.incentiveUpload.result.tile.readLabel' }}</span></div>
                <div class="ok"><b>{{ c.valid | number }}</b>&ngsp;<span>{{ 'Ready to save' | t: 'staff.incentiveUpload.result.tile.validLabel' }}</span></div>
                <div class="bad"><b>{{ c.invalid | number }}</b>&ngsp;<span>{{ 'Rows with errors' | t: 'staff.incentiveUpload.result.tile.invalidLabel' }}</span></div>
              </div>
              @if (c.alreadyUploaded) {
                <p class="sub" id="alreadyUploaded">{{ '{count} row(s) were uploaded before and will be skipped.' | t: 'staff.incentiveUpload.result.alreadyNote' : { count: (c.alreadyUploaded | number) } }}</p>
              }
              @if (c.errors.length) {
                <div class="iu-errhead">
                  <span>{{ 'Rows with errors' | t: 'staff.incentiveUpload.result.errors.title' }}</span>
                  <button type="button" class="btn btn-link p-0" (click)="downloadRejected()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>{{ 'Download the {count} rows (.xlsx)' | t: 'staff.incentiveUpload.result.errors.downloadButton' : { count: (c.invalid | number) } }}</button>
                </div>
                <div class="list-card iu-errs">
                  <div class="table-responsive">
                    <table class="table table-zed">
                      <thead><tr><th>{{ 'Row' | t: 'staff.incentiveUpload.result.errors.column.row' }}</th><th>{{ 'Column' | t: 'staff.incentiveUpload.result.errors.column.column' }}</th><th>{{ 'Value' | t: 'staff.incentiveUpload.result.errors.column.value' }}</th><th>{{ 'Problem' | t: 'staff.incentiveUpload.result.errors.column.problem' }}</th></tr></thead>
                      <tbody>
                        @for (e of errorsView.page(); track $index) {
                          <tr><td><b>{{ e.row || '' }}</b></td><td>{{ e.column || ('Whole row' | t: 'staff.incentiveUpload.result.errors.wholeRow') }}</td><td class="sub">{{ e.value ?? ('blank' | t: 'staff.incentiveUpload.result.errors.blank') }}</td><td>{{ e.message }}</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <zed-pager [pager]="errorsView" />
                </div>
                @if (c.errorCount > c.errors.length) {
                  <p class="sub mt-2">{{ 'The first {shown} of {total} errors are listed; the download has every rejected row.' | t: 'staff.incentiveUpload.result.errors.moreNote' : { shown: (c.errors.length | number), total: (c.errorCount | number) } }}</p>
                }
              }
              @if (applyError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ applyError() }}</div> }
            </div>
            <div class="iu-pop-foot">
              <span class="sub">{{ 'Nothing is saved until you confirm.' | t: 'staff.incentiveUpload.result.note' }}</span>
              <div class="d-flex gap-2">
                <button type="button" class="btn btn-default" (click)="cancel()">{{ 'Cancel upload' | t: 'staff.incentiveUpload.result.cancelButton' }}</button>
                <button type="button" class="btn btn-primary" [disabled]="busy() || !c.valid" (click)="apply()">
                  {{ busy() ? ('Saving…' | t: 'staff.incentiveUpload.result.savingButton') : c.valid === 1 ? ('Save {count} row' | t: 'staff.incentiveUpload.result.saveRowButton' : { count: (c.valid | number) }) : ('Save {count} rows' | t: 'staff.incentiveUpload.result.saveRowsButton' : { count: (c.valid | number) }) }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .iu-grid { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 20px; align-items: start; }
    .iu-main { display: grid; gap: 16px; min-width: 0; }
    .iu-card { padding: 24px; margin: 0; }
    .iu-drop { display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 150px; justify-content: center; padding: 20px 16px; margin: 0;
      border: 1.5px dashed #3ba3ad; border-radius: 12px; background: #f6fbfb; text-align: center; cursor: pointer; }
    .iu-drop.over, .iu-drop:hover { background: #ecf6f6; }
    .iu-drop:focus-within { outline: 2px solid #3ba3ad; outline-offset: 2px; }
    .iu-drop b { margin-top: 8px; font-size: 15px; color: #17373b; overflow-wrap: anywhere; }
    .iu-drop small { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .iu-icon { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #e6f2f3; }
    svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .iu-icon svg { width: 20px; height: 20px; color: #24666b; }
    .iu-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-top: 16px; }
    .iu-foot .btn { min-width: 180px; min-height: 42px; }
    .iu-box { padding: 0; margin: 0; overflow: hidden; }
    .iu-h { display: flex; align-items: center; gap: 12px; margin: 0; padding: 13px 20px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; color: #17373b; }
    .iu-tile { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #e6f2f3; color: #24666b; }
    .iu-tile svg { width: 16px; height: 16px; }
    .iu-body { padding: 16px 24px 20px; }
    .iu-cols { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .iu-cols span { padding: 4px 11px; border-radius: 6px; background: #eef3f3; color: #17373b; font-size: 12px; font-weight: 600; line-height: 18px; }
    .iu-tips { list-style: none; margin: 0; display: grid; gap: 12px; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .iu-tips li { position: relative; padding-left: 34px; }
    .iu-tips li::before { content: '✓'; position: absolute; left: 0; top: 0; width: 18px; height: 18px; border-radius: 50%; background: #2f9e58; color: #fff;
      font-size: 11px; font-weight: 700; display: grid; place-items: center; }
    .sub { color: #6f8487; font-size: 12.5px; font-weight: 500; }
    .uploaded td { font-size: 13px; white-space: nowrap; }
    .iu-dialog { max-width: 900px; }
    .iu-pop { border: 0; border-radius: 16px; }
    .iu-pop-head { display: flex; align-items: center; gap: 14px; padding: 20px 24px 18px; border-bottom: 1px solid #dde7e8; }
    .iu-tile-lg { width: 40px; height: 40px; border-radius: 10px; }
    .iu-tile-lg svg { width: 20px; height: 20px; }
    .iu-pop-t { flex: 1; min-width: 0; }
    .iu-pop-t h3 { font-size: 18px; font-weight: 700; color: #17373b; }
    .iu-pop-t small { font-size: 12.5px; font-weight: 500; color: #6f8487; overflow-wrap: anywhere; }
    .iu-x { flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: #eef3f3; color: #17373b; display: grid; place-items: center; }
    .iu-x svg { width: 16px; height: 16px; }
    .iu-x:hover { background: #e1eaea; }
    .iu-pop .modal-body { padding: 20px 28px; }
    .iu-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
    .iu-tiles > div { border: 1px solid #dde7e8; border-radius: 12px; padding: 14px 18px; background: #f6fbfb; }
    .iu-tiles .ok { background: #e5f5ea; }
    .iu-tiles .bad { background: #fbe9e7; }
    .iu-tiles b { display: block; font-size: 22px; font-weight: 800; color: #24666b; line-height: 1.3; }
    .iu-tiles .ok b { color: #2f9e58; }
    .iu-tiles .bad b { color: #c8473c; }
    .iu-tiles span { font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .iu-errhead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; align-items: center; margin: 4px 0 8px; font-size: 10.5px;
      font-weight: 800; letter-spacing: .9px; text-transform: uppercase; color: #6f8487; }
    .iu-errhead .btn-link { display: inline-flex; align-items: center; gap: 6px; padding: 0 8px 0 0; font-size: 12.5px; font-weight: 700; color: #24666b;
      text-transform: none; letter-spacing: 0; text-decoration: none; }
    .iu-errhead .btn-link svg { width: 14px; height: 14px; }
    .iu-errs { border-radius: 14px; }
    .iu-errs td { font-size: 12.5px; color: #3d5559; }
    .iu-errs td:first-child { width: 80px; color: #17373b; }
    .iu-errs td:nth-child(2) { width: 190px; }
    .iu-errs td:nth-child(3) { width: 220px; font-size: 11.5px; color: #6f8487; }
    .iu-pop-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 28px; border-top: 1px solid #dde7e8; }
    .iu-pop-foot .btn { min-height: 40px; min-width: 150px; }
    .iu-pop-foot .btn-primary { min-width: 180px; }
    @media (max-width: 1199.98px) { .iu-grid { grid-template-columns: minmax(0, 1fr) 340px; } }
    @media (max-width: 991.98px) { .iu-grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 575.98px) { .iu-tiles b { font-size: 18px; } .iu-tiles { gap: 8px; } .iu-pop .modal-body, .iu-pop-foot { padding-left: 16px; padding-right: 16px; } }
  `,
})
export class IncentiveUploadPage {
  private readonly http = inject(HttpClient);
  private readonly exporter = inject(TableExport);
  private readonly toast = inject(ToastService);

  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.incentiveUpload.crumb', 'Upload API Incentives') }));
  protected readonly columns = COLUMNS;
  /** 2026-11-18: "You are here" under the current step (staff-17). */
  protected readonly steps = computed<TrackerStep[]>(() => {
    const now = this.step();
    return [
      { label: t('staff.incentiveUpload.step.chooseLabel', 'Choose the workbook'),
        note: now === 0 ? t('staff.incentiveUpload.step.hereNote', 'You are here') : t('staff.incentiveUpload.step.chooseNote', 'The .xlsx file') },
      { label: t('staff.incentiveUpload.step.checkLabel', 'Check every row'),
        note: now === 1 ? t('staff.incentiveUpload.step.hereNote', 'You are here') : t('staff.incentiveUpload.step.checkNote', 'Errors listed by row') },
      { label: t('staff.incentiveUpload.step.saveLabel', 'Save'),
        note: now === 3 ? t('staff.incentiveUpload.step.savedNote', 'Saved') : t('staff.incentiveUpload.step.saveNote', 'Only valid rows') },
    ];
  });
  protected readonly file = signal<File | null>(null);
  protected readonly dragging = signal(false);
  protected readonly busy = signal(false);
  protected readonly templateBusy = signal(false);
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
      this.error.set(t('staff.incentiveUpload.fileError', 'Upload valid excel file (accepted format: .xlsx, up to 5 MB).'));
      this.file.set(null);
      return;
    }
    this.file.set(f);
  }

  /**
   * 2026-11-21 (UI audit B5): the template is fetched with HttpClient and saved, not opened by a plain link to the API (a page
   * navigation to it was answered 503 on production while the same call from the page returned the workbook).
   */
  protected async downloadTemplate(): Promise<void> {
    this.error.set('');
    this.templateBusy.set(true);
    try {
      await this.exporter.file(INCENTIVE_TEMPLATE_API, 'IncentiveTemplate.xlsx');
    } catch (err) {
      this.error.set(await blobErrorMessage(err));
    } finally {
      this.templateBusy.set(false);
    }
  }

  /** Step 2: the server checks every row; nothing is saved. */
  protected async check(): Promise<void> {
    const f = this.file();
    if (!f) {
      this.error.set(t('staff.incentiveUpload.noFileError', 'Please choose the incentives Excel file.'));
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
      if (r.inserted) this.toast.success(t('staff.incentiveUpload.toast.saved', 'Incentives saved'), r.message);
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
  protected async downloadRejected(): Promise<void> {
    const c = this.result();
    if (!c) return;
    const base = c.fileName.replace(/\.xlsx$/i, '') || 'incentives';
    this.applyError.set('');
    try {
      // 2026-11-18: as .xlsx (staff-popup-10), the format the upload takes back once corrected.
      await this.exporter.xlsx(`${base}-rows-with-errors`, [{
        name: 'Rows with errors',
        columns: ['Row', ...c.columns, 'Problems'],
        rows: c.rejected.map((r) => [r.row, ...r.cells, r.problems]),
      }]);
    } catch (err) {
      this.applyError.set(apiErrorMessage(err));
    }
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
