import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** One sheet of an export: the column headings and the rows, as the page shows them. */
export interface ExportSheet {
  name: string;
  columns: string[];
  rows: (string | number | null | undefined)[][];
}

export const EXPORT_XLSX_API = '/api/staff/export/xlsx';

/**
 * 2026-11-17 (the user's staff designs: "Export" on the dashboard, payments received, completed assessments): the data a
 * staff page has loaded, as Excel (.xlsx, written by the server: POST api/staff/export/xlsx) or CSV (made in the browser,
 * UTF-8 with a BOM so Excel reads it). Text that a spreadsheet would run as a formula is made inert in both.
 */
@Injectable({ providedIn: 'root' })
export class TableExport {
  private readonly http = inject(HttpClient);

  /** Downloads the sheets as one .xlsx workbook. */
  async xlsx(fileName: string, sheets: ExportSheet[]): Promise<void> {
    const blob = await firstValueFrom(this.http.post(EXPORT_XLSX_API, { fileName, sheets: sheets.map(clean) }, { responseType: 'blob' }));
    save(blob, ensureExt(fileName, '.xlsx'));
  }

  /** Downloads one sheet as CSV. */
  csv(fileName: string, sheet: ExportSheet): void {
    save(new Blob(['﻿' + toCsv(sheet)], { type: 'text/csv;charset=utf-8' }), ensureExt(fileName, '.csv'));
  }
}

/** The CSV text of a sheet (RFC 4180 quoting; formula-like text gets a leading apostrophe). */
export function toCsv(sheet: ExportSheet): string {
  const line = (cells: unknown[]) => cells.map((c) => quote(c)).join(',');
  return [line(sheet.columns), ...sheet.rows.map((r) => line(sheet.columns.map((_, i) => r[i])))].join('\r\n');
}

function quote(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function clean(sheet: ExportSheet): ExportSheet {
  return { ...sheet, rows: sheet.rows.map((r) => sheet.columns.map((_, i) => (r[i] === undefined ? null : r[i]))) };
}

function ensureExt(name: string, ext: string): string {
  const base = (name || 'zed-export').replace(/\.(xlsx|csv)$/i, '');
  return base + ext;
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
