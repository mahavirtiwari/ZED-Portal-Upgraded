import { fillPlaceholders, htmlToPlain, type AppTexts } from '@zed/shared';
import { BUILT_IN_TEXTS } from './content/builtInTexts';
import type { AssessmentDetails, PhotoInformation } from './models';

/**
 * The site tour sections of the unit (Admin → Site Tour Sections, answered with the unit as `siteTourSections`): the
 * photos are filed under them, each needs at least `min` photos (checked before the closing meeting) and takes at most
 * `max`; `uploaded` is what the team had sent when the assessment was opened. An older server answers none: the standard
 * ten sections of the redesign (the server's defaults).
 */
export type TourSection = { key: string; title: string; hint: string; min: number; max: number; uploaded: number };

/** The server's standard sections (Zed.Core.Assessment.SiteTourSections.Defaults). */
export const STANDARD_SECTIONS: readonly TourSection[] = [
  { key: 'entrance', title: 'Unit Entrance & Signage', hint: 'Gate, unit name board, premises', min: 1, max: 2, uploaded: 0 },
  { key: 'inward', title: 'Raw Material Inward & Store', hint: 'Receipt, GRN area, RM racks', min: 2, max: 3, uploaded: 0 },
  { key: 'production', title: 'Production / Machine Shop', hint: 'Process lines, machines, operators', min: 3, max: 5, uploaded: 0 },
  { key: 'inprocess', title: 'In-process Inspection', hint: 'Gauges, check points, control charts', min: 2, max: 3, uploaded: 0 },
  { key: 'assembly', title: 'Assembly & Packing', hint: 'Assembly bay, packing, labelling', min: 2, max: 3, uploaded: 0 },
  { key: 'fgstore', title: 'Finished Goods Store', hint: 'FG racks, identification, FIFO', min: 2, max: 3, uploaded: 0 },
  { key: 'dispatch', title: 'Dispatch / Outward', hint: 'Loading bay, dispatch register', min: 1, max: 2, uploaded: 0 },
  { key: 'utilities', title: 'Utilities', hint: 'Power, compressor, boiler, DG set', min: 2, max: 3, uploaded: 0 },
  { key: 'safety', title: 'Safety & Fire', hint: 'PPE, extinguishers, assembly point', min: 2, max: 3, uploaded: 0 },
  { key: 'environment', title: 'Environment & Housekeeping', hint: 'Scrap yard, effluent, waste, 5S', min: 2, max: 3, uploaded: 0 },
];

export function sectionsOf(d: Pick<AssessmentDetails, 'siteTourSections'> | null | undefined): TourSection[] {
  const list = d?.siteTourSections;
  if (!list?.length) return STANDARD_SECTIONS.map(s => ({ ...s }));
  return list.map(s => ({
    key: s.id ?? s.title ?? '',
    title: s.title ?? '',
    hint: s.hint ?? '',
    min: Number(s.min ?? 0),
    max: Number(s.max ?? 0),
    uploaded: Number(s.uploaded ?? 0),
  }));
}

/** The section is kept on the phone at the front of the photo's comment: "[Utilities] DG set". */
export function encodeTourComment(sections: readonly TourSection[], key: string | null, remark: string): string {
  const s = sections.find(x => x.key === key);
  return s ? `[${s.title}] ${remark}` : remark;
}

/** The photo's section (null: none, or one the unit does not have) and its remark. */
export function decodeTourComment(sections: readonly TourSection[], comment: string | null | undefined): { section: string | null; remark: string } {
  const text = comment ?? '';
  const m = /^\[([^\]]+)\] ?/.exec(text);
  const s = m ? sections.find(x => x.title === m[1]) : undefined;
  return s && m ? { section: s.key, remark: text.slice(m[0].length) } : { section: null, remark: text };
}

/**
 * SA/SubmitSiteTour gets the section as the photo's `section` (its key), with the remark alone in `comment`; the server
 * files it in the photo's name. A comment that starts with anything else in brackets is sent as it is.
 */
export function withSection<P extends { comment?: string | null; section?: string | null }>(p: P, sections: readonly TourSection[]): P {
  const { section, remark } = decodeTourComment(sections, p.comment);
  return section ? { ...p, section, comment: remark } : p;
}

/**
 * The photos of each section: the team's uploaded ones (as of opening the assessment) and this phone's not yet sent (all
 * of this phone's once its site tour is submitted, as they are then among the uploaded ones).
 */
export function tourCounts(sections: readonly TourSection[], local: readonly PhotoInformation[], submitted: boolean): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of sections) counts[s.key] = s.uploaded;
  if (submitted) return counts;
  for (const p of local) {
    const { section } = decodeTourComment(sections, p.comment);
    if (section) counts[section] = (counts[section] ?? 0) + 1;
  }
  return counts;
}

/** The server's refusal of a photo beyond the section's maximum (SA/SubmitSiteTour), shown before it is taken. */
export const sectionFull = (s: TourSection) => `Site Tour: "${s.title}" takes at most ${s.max} photo${s.max === 1 ? '' : 's'}.`;

/** The first section short of its minimum, as the server's closing-meeting refusal; null when every section has its photos. */
export function tourShortfall(sections: readonly TourSection[], counts: Record<string, number>): string | null {
  for (const s of sections) {
    const n = counts[s.key] ?? 0;
    if (n < s.min)
      return `Site Tour: "${s.title}" needs at least ${s.min} photo${s.min === 1 ? '' : 's'} (${n} captured). Please capture and sync them before the closing meeting.`;
  }
  return null;
}

/** 2026-11-28: every section short of its minimum, with the photos it has, in the unit's order. */
export function tourMissing(sections: readonly TourSection[], counts: Record<string, number>): { section: TourSection; count: number }[] {
  return sections.map(section => ({ section, count: counts[section.key] ?? 0 })).filter(m => m.count < m.section.min);
}

/**
 * 2026-11-28: the site tour is submitted (Sync) only once every section has its minimum of photos, the team's uploaded
 * ones and this phone's counted (SA/SubmitSiteTour refuses the lead's tour otherwise). The message names each section that
 * is short; null when none is. Wording: Admin → Texts (app.assessor.siteTour.missing / missingSection), the standard wording when
 * the Admin switched it off.
 */
export function tourMissingMessage(texts: AppTexts, sections: readonly TourSection[], counts: Record<string, number>): string | null {
  const missing = tourMissing(sections, counts);
  if (missing.length === 0) return null;
  const text = (key: string, fields: Record<string, string | number>) => {
    const r = texts.get(key, fields);
    return (r ? htmlToPlain(r.html).trim() : '') || htmlToPlain(fillPlaceholders(BUILT_IN_TEXTS[key] ?? '', fields)).trim();
  };
  const list = missing.map(m => text('app.assessor.siteTour.missingSection', { Section: m.section.title, Captured: m.count, Required: m.section.min })).join(', ');
  return text('app.assessor.siteTour.missing', { Sections: list });
}

/** 2026-11-28: the whole site tour being submitted (every photo's id and section), sent with every chunk (SA/SubmitSiteTour). */
export function tourList(photos: readonly PhotoInformation[], sections: readonly TourSection[]): { photoId: string; section: string | null }[] {
  return photos.map(p => ({ photoId: p.photoId, section: decodeTourComment(sections, p.comment).section }));
}
