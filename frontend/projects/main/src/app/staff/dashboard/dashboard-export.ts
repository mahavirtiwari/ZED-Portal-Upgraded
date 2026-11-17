import { ExportSheet } from '../table-export';

/** 2026-11-17 (approved staff redesign, pop-up "Export dashboard"): the parts of the dashboard an export can hold. */
export type ExportSection = 'headline' | 'levels' | 'trend' | 'who' | 'tables';
export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

export interface ExportChoice {
  sections: ExportSection[];
  format: ExportFormat;
}

/**
 * The sections, in the page's order. The design's "Unit-level rows" is not offered: the dashboard loads counts only, not
 * the units (the Registered MSME list exports those).
 */
export const EXPORT_SECTIONS: readonly { key: ExportSection; label: string }[] = [
  { key: 'headline', label: 'Headline numbers' },
  { key: 'levels', label: 'Applications by level' },
  { key: 'trend', label: 'Monthly and yearly trend' },
  { key: 'who', label: 'MSME size, gender and social category' },
  { key: 'tables', label: 'State, district and sector tables' },
];

/** A sheet and how many of its first columns name the row (the others are figures): how the CSV lists it. */
export interface KeyedSheet extends ExportSheet {
  keys: number;
}

/**
 * The sheets as one CSV table (a CSV has one sheet): one line per figure, "Section, Item, Figure, Value"; empty figures
 * are left out.
 */
export function flattenSheets(name: string, sheets: KeyedSheet[]): ExportSheet {
  const rows: ExportSheet['rows'] = [];
  for (const s of sheets) {
    for (const r of s.rows) {
      const item = r.slice(0, s.keys).filter((v) => v !== null && v !== undefined && v !== '').join(' · ');
      for (let j = s.keys; j < s.columns.length; j++) {
        if (r[j] === null || r[j] === undefined || r[j] === '') continue;
        rows.push([s.name, item, s.columns[j], r[j]]);
      }
    }
  }
  return { name, columns: ['Section', 'Item', 'Figure', 'Value'], rows };
}

/** A share in percent with one decimal (null without a total). */
export function sharePercent(value: number, total: number): number | null {
  return total ? Math.round((value / total) * 1000) / 10 : null;
}

/** The file name of an export: ZED-Dashboard-yyyyMMddHHmm. */
export function exportName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `ZED-Dashboard-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}`;
}
