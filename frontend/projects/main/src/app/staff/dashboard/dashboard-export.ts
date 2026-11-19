import { ExportSheet } from '../table-export';
import { t } from '../../content/page-text';

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
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): checked again: the one unit list the API has
 * (api/staff/dashboard/registered-msme, at most 1,000 rows a page) filters by state, level, size and gender only, not by
 * district, social category, sector, date basis or dates, so it cannot give the units the dashboard's filters select.
 */
export const EXPORT_SECTIONS: readonly { key: ExportSection; readonly label: string }[] = [
  { key: 'headline', get label() { return t('staff.dashboard.export.section.headline', 'Headline numbers'); } },
  { key: 'levels', get label() { return t('staff.dashboard.export.section.levels', 'Applications by level'); } },
  { key: 'trend', get label() { return t('staff.dashboard.export.section.trend', 'Monthly and yearly trend'); } },
  { key: 'who', get label() { return t('staff.dashboard.export.section.who', 'MSME size, gender and social category'); } },
  { key: 'tables', get label() { return t('staff.dashboard.export.section.tables', 'State, district and sector tables'); } },
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
  const columns = [
    t('staff.dashboard.export.csv.column.section', 'Section'), t('staff.dashboard.export.csv.column.item', 'Item'),
    t('staff.dashboard.export.csv.column.figure', 'Figure'), t('staff.dashboard.export.csv.column.value', 'Value'),
  ];
  return { name, columns, rows };
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
