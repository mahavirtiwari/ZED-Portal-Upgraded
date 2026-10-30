import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

export type SheetResult = 'new' | 'changed' | 'same' | 'error';

export interface SheetRow {
  row: number;
  values: string[];
  result: SheetResult;
  changed: string[];
  was: string[] | null;
  errors: string[];
  notes: string[];
}

export interface SheetCheck {
  columns: string[];
  matchRule: string;
  new: number;
  changed: number;
  unchanged: number;
  errors: number;
  rows: SheetRow[];
}

export interface SheetApplied {
  message: string;
  added: number;
  updated: number;
  failed: number;
  rows: SheetRow[];
}

type Filter = 'all' | SheetResult;

const RESULT_LABELS: Record<SheetResult, string> = { new: 'New', changed: 'Changed', same: 'No change', error: 'Errors' };

/** The problem title of a failed blob request (the API answers problem+json). */
export async function blobErrorMessage(err: unknown): Promise<string> {
  const e = err as { error?: unknown };
  if (e?.error instanceof Blob) {
    try {
      const title = (JSON.parse(await e.error.text()) as { title?: string }).title;
      if (title) return title;
    } catch {
      /* not JSON */
    }
  }
  return apiErrorMessage(err);
}

/**
 * Export Excel and Upload Excel of an Admin master (V4), next to the page's Add button. Export downloads the whole
 * master in the template's columns. Upload opens a pop-up: download the template, choose the file, check it (every row
 * is new, changed, the same or has errors, with the reasons; nothing is changed), then apply the valid rows. Rows
 * with errors are skipped; nothing is deleted. The API is `{api}/excel` (export), `/excel/template`, `/excel/check`
 * and `/excel/apply`. Without `uploadable` only the export and the template are offered (the LG Directory page has
 * its own upload).
 */
@Component({
  selector: 'zed-excel-tools',
  template: `
    <button type="button" class="btn btn-default xl-btn" [disabled]="busy() === 'export'" (click)="export()">
      <span class="xl-icon" aria-hidden="true">X</span> {{ busy() === 'export' ? 'PLEASE WAIT' : 'Export Excel' }}</button>
    @if (uploadable()) {
      <button type="button" class="btn btn-default xl-btn" (click)="openUpload()"><span class="xl-icon" aria-hidden="true">X</span> Upload Excel</button>
    } @else {
      <button type="button" class="btn btn-default xl-btn" [disabled]="busy() === 'template'" (click)="template()">
        <span class="xl-icon" aria-hidden="true">X</span> Excel template</button>
    }
    @if (error() && !open()) { <span class="xl-fail help-block" role="alert">{{ error() }}</span> }

    @if (open()) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="xl-title">
        <!-- Width and footer inline: the legacy site styles size pop-ups and footers more specifically than a component can. -->
        <div class="modal-dialog modal-popup xl-dialog" style="max-width: min(1100px, calc(100vw - 32px))">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="xl-title">Upload {{ title() }} from Excel</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="close()"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <ol class="xl-steps" aria-label="Steps">
                <li [class.ok]="templateTaken() || !!file()">1 Template{{ templateTaken() || file() ? ' ✓' : '' }}</li>
                <li [class.ok]="!!file()" [class.on]="!file()">2 Choose file{{ file() ? ' ✓' : '' }}</li>
                <li [class.ok]="!!check() || !!applied()" [class.on]="!!file() && !check() && !applied()">3 Check{{ check() || applied() ? ' ✓' : '' }}</li>
                <li [class.ok]="!!applied()" [class.on]="!!check() && !applied()">4 Apply{{ applied() ? ' ✓' : '' }}</li>
              </ol>

              <div class="xl-file">
                <span class="xl-icon" aria-hidden="true">X</span>
                <b class="xl-file-name">@if (file(); as f) { {{ f.name }} <span class="muted">· {{ size(f.size) }}@if (check(); as c) { · {{ c.rows.length }} rows }</span> } @else { No file chosen }</b>
                <button type="button" class="btn btn-default btn-sm" [disabled]="busy() === 'template'" (click)="template()">⬇ Download template</button>
                <label class="btn btn-default btn-sm mb-0">{{ file() ? 'Choose another file' : 'Choose file' }}
                  <input type="file" class="visually-hidden" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="choose($event)" /></label>
              </div>

              @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
              @if (applied(); as a) { <div class="alert alert-success" role="status">{{ a.message }}</div> }
              @if (busy() === 'check') { <p class="muted">Checking the file…</p> }

              @if (shown(); as c) {
                <p class="muted xl-rule">{{ c.matchRule }}</p>
                <div class="xl-sum" role="group" aria-label="Rows by result">
                  @for (s of tiles(); track s.key) {
                    <button type="button" class="xl-tile xl-{{ s.key }}" [class.active]="filter() === s.key" [attr.aria-pressed]="filter() === s.key"
                            (click)="filter.set(filter() === s.key ? 'all' : s.key)"><b>{{ s.count }}</b> {{ s.label }}</button>
                  }
                </div>
                <div class="table-responsive xl-table">
                  <table class="table">
                    <thead><tr><th scope="col">Row</th>@for (h of c.columns; track $index) { <th scope="col">{{ h }}</th> }<th scope="col">Result</th></tr></thead>
                    <tbody>
                      @for (r of visible(); track r.row) {
                        <tr [class.is-error]="r.result === 'error'">
                          <td>{{ r.row }}</td>
                          @for (v of r.values; track $index) {
                            <td>@if (r.was && r.changed.includes(c.columns[$index])) { <span class="xl-was">{{ r.was[$index] || '—' }}</span> }{{ v }}</td>
                          }
                          <td class="xl-result">
                            @switch (r.result) {
                              @case ('new') { <span class="xl-tag t-new">{{ applied() ? 'Added' : 'New' }}</span> }
                              @case ('changed') { <span class="xl-tag t-chg">{{ applied() ? 'Updated' : 'Changed' }}: {{ r.changed.join(', ') }}</span> }
                              @case ('same') { <span class="xl-tag t-same">No change</span> }
                              @case ('error') { <span class="xl-tag t-err">{{ r.errors.join(' · ') }}</span> }
                            }
                            @for (n of r.notes; track $index) { <small class="d-block muted mt-1">{{ n }}</small> }
                          </td>
                        </tr>
                      } @empty {
                        <tr><td [attr.colspan]="c.columns.length + 2" class="muted">No rows of this kind.</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else if (!file()) {
                <p class="muted mb-0">Download the template (or Export Excel to edit the current list), fill it in, then choose the file. Only .xlsx files are accepted (up to 5 MB).</p>
              }
            </div>
            <div class="modal-footer xl-foot" style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap">
              <span class="muted">@if (check() && !applied()) { Rows with errors are skipped. Correct them in the file and upload again, or apply the others now. }</span>
              <span>
                <button type="button" class="btn btn-default" (click)="close()">{{ applied() ? 'CLOSE' : 'CANCEL' }}</button>
                @if (check(); as c) {
                  @if (!applied()) {
                    <button type="button" class="btn btn-primary" [disabled]="busy() === 'apply' || c.new + c.changed === 0" (click)="apply()">
                      {{ busy() === 'apply' ? 'PLEASE WAIT' : 'APPLY ' + (c.new + c.changed) + ' ROW' + (c.new + c.changed === 1 ? '' : 'S') }}</button>
                  }
                }
              </span>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    :host { display: contents; }
    .xl-btn { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .xl-icon { width: 16px; height: 16px; border-radius: 3px; background: #1e7a3c; color: #fff; font: 800 9px Arial, sans-serif; display: inline-grid; place-items: center; flex: none; }
    .xl-fail { flex-basis: 100%; text-align: right; }
    .xl-steps { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 0 0 14px; font-size: 12.5px; }
    .xl-steps li { padding: 4px 12px; border-radius: 14px; background: #f2f4f4; color: #5f6f70; font-weight: 600; }
    .xl-steps li.on { background: #45a5ad; color: #fff; }
    .xl-steps li.ok { background: #e6f6ec; color: #1e7a3c; }
    .xl-file { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
    .xl-file-name { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
    .xl-rule { margin-bottom: 10px; }
    .xl-sum { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .xl-tile { border: 1px solid #dfe9ea; border-radius: 10px; padding: 8px 12px; background: #fff; text-align: left; color: #5f6f70; font-size: 13px; }
    .xl-tile b { font-size: 20px; display: block; }
    .xl-tile.active { border-color: #45a5ad; box-shadow: 0 0 0 2px rgba(69, 165, 173, 0.25); }
    .xl-new b { color: #1e7a3c; } .xl-changed b { color: #2f7c83; } .xl-same b { color: #8a9899; } .xl-error b { color: #a8303a; }
    .xl-table { max-height: 46vh; overflow: auto; border: 1px solid #eef3f3; border-radius: 8px; }
    .xl-table table { margin: 0; font-size: 13px; }
    .xl-table th { position: sticky; top: 0; background: #45a5ad; color: #fff; font-size: 12.5px; white-space: nowrap; }
    .xl-table td { vertical-align: top; white-space: pre-line; overflow-wrap: break-word; min-width: 72px; max-width: 280px; }
    .xl-table tr.is-error td { background: #fffafa; }
    .xl-result { min-width: 180px; }
    .xl-tag { display: inline-block; font-size: 11.5px; font-weight: 700; border-radius: 10px; padding: 1px 8px; white-space: normal; }
    .t-new { background: #e6f6ec; color: #1e7a3c; } .t-chg { background: #eef6f6; color: #2f7c83; } .t-same { background: #f2f4f4; color: #5f6f70; }
    .t-err { background: #fdeef0; color: #a8303a; }
    .xl-was { color: #8a9899; text-decoration: line-through; font-size: 12px; margin-right: 4px; }
    @media (max-width: 575.98px) { .xl-sum { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `,
})
export class ExcelToolsComponent {
  private readonly http = inject(HttpClient);

  /** The master's API, e.g. /api/staff/masters/sectors. */
  readonly api = input.required<string>();
  /** The master's name in the pop-up title, e.g. Sectors. */
  readonly title = input.required<string>();
  /** The downloaded file's name without .xlsx, e.g. sectors. */
  readonly fileName = input.required<string>();
  readonly uploadable = input(true);
  /** After rows were saved: the page reloads its list. */
  readonly applied$ = output<SheetApplied>({ alias: 'applied' });

  protected readonly open = signal(false);
  protected readonly file = signal<File | null>(null);
  protected readonly check = signal<SheetCheck | null>(null);
  protected readonly applied = signal<SheetApplied | null>(null);
  protected readonly templateTaken = signal(false);
  protected readonly busy = signal<'export' | 'template' | 'check' | 'apply' | null>(null);
  protected readonly error = signal('');
  protected readonly filter = signal<Filter>('all');

  /** What the table shows: the check, or after applying, its outcome. */
  protected readonly shown = computed<SheetCheck | null>(() => {
    const a = this.applied();
    const c = this.check();
    if (!a || !c) return c;
    return { ...c, new: a.added, changed: a.updated, unchanged: a.rows.filter((r) => r.result === 'same').length, errors: a.failed, rows: a.rows };
  });

  protected readonly tiles = computed(() => {
    const c = this.shown();
    if (!c) return [];
    const done = !!this.applied();
    return [
      { key: 'new' as const, count: c.new, label: done ? 'Added' : RESULT_LABELS.new },
      { key: 'changed' as const, count: c.changed, label: done ? 'Updated' : RESULT_LABELS.changed },
      { key: 'same' as const, count: c.unchanged, label: RESULT_LABELS.same },
      { key: 'error' as const, count: c.errors, label: done ? 'Skipped (errors)' : 'With errors' },
    ];
  });

  protected readonly visible = computed(() => {
    const rows = this.shown()?.rows ?? [];
    const f = this.filter();
    return f === 'all' ? rows : rows.filter((r) => r.result === f);
  });

  protected size(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  protected openUpload(): void {
    this.file.set(null);
    this.check.set(null);
    this.applied.set(null);
    this.templateTaken.set(false);
    this.error.set('');
    this.filter.set('all');
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
    this.error.set('');
  }

  protected async export(): Promise<void> {
    await this.download(`${this.api()}/excel`, `${this.fileName()}.xlsx`, 'export');
  }

  protected async template(): Promise<void> {
    if (await this.download(`${this.api()}/excel/template`, `${this.fileName()}-template.xlsx`, 'template')) this.templateTaken.set(true);
  }

  private async download(url: string, name: string, kind: 'export' | 'template'): Promise<boolean> {
    this.error.set('');
    this.busy.set(kind);
    try {
      const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      return true;
    } catch (err) {
      this.error.set(await blobErrorMessage(err));
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  protected async choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    this.file.set(file);
    this.check.set(null);
    this.applied.set(null);
    this.filter.set('all');
    this.error.set('');
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.error.set('Please choose an Excel file (.xlsx). Save an .xls or .csv file as .xlsx first.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.error.set('The file is larger than 5 MB.');
      return;
    }
    this.busy.set('check');
    try {
      this.check.set(await firstValueFrom(this.http.post<SheetCheck>(`${this.api()}/excel/check`, this.form(file))));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected async apply(): Promise<void> {
    const file = this.file();
    if (!file) return;
    this.error.set('');
    this.busy.set('apply');
    try {
      const result = await firstValueFrom(this.http.post<SheetApplied>(`${this.api()}/excel/apply`, this.form(file)));
      this.applied.set(result);
      this.filter.set('all');
      if (result.added + result.updated > 0) this.applied$.emit(result);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  private form(file: File): FormData {
    const form = new FormData();
    form.append('file', file, file.name);
    return form;
  }
}
