import { t } from '../../content/page-text';
import { num, text } from './assessment-shared';
import { DaDetails, NcRound, Row } from './assessment.api';

/**
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files', the new staff-14 series: 14a overview, 14c non-conformances):
 * what the overview's link cards and the non-conformance tracker show, worked out from the record's own rows only. An item's
 * state in a round comes from that round's rows: raised in the round and decided Yes = accepted, decided No = not accepted
 * (carried to the next round), not decided yet = open; not in the round = not needed.
 */

export type RoundState = 'accepted' | 'rejected' | 'open' | 'none';

export interface TrackRound {
  round: number;
  state: RoundState;
  /** The round's raise date from the record (Nc{n}Raised), as given. */
  date: string;
}

export interface TrackItem {
  key: string;
  /** "3.1 Safety risks are identified…" or "Site exterior photos". */
  title: string;
  /** "Parameter 3 · Occupational Safety" or "Basic information". */
  group: string;
  kind: 'requirement' | 'photo' | 'product';
  rounds: TrackRound[];
  /** The last round the item was raised in, and its state there. */
  last: number;
  outcome: RoundState;
  /** The requirement row of the last round (to open its card in "By round"). */
  row: Row | null;
}

const verdict = (v: string): RoundState => (v === 'Yes' ? 'accepted' : v === 'No' ? 'rejected' : 'open');

/** NC 1 … NC n of the record (the rounds the API sent), oldest first. */
export function roundNumbers(d: DaDetails | null): number[] {
  return [...new Set((d?.ncRounds ?? []).map((r) => r.ncCount))].filter((n) => n > 0).sort((a, b) => a - b);
}

function track(d: DaDetails, rounds: number[], kind: TrackItem['kind'], key: string, title: string, group: string,
  pick: (rd: NcRound) => { raised: boolean; decision: string; row?: Row | null }): TrackItem | null {
  const m = d.msme;
  let last = 0;
  let outcome: RoundState = 'none';
  let row: Row | null = null;
  const out: TrackRound[] = [];
  for (const n of rounds) {
    const rd = d.ncRounds.find((r) => r.ncCount === n)!;
    const p = pick(rd);
    const state: RoundState = p.raised ? verdict(p.decision) : 'none';
    if (p.raised) {
      last = n;
      outcome = state;
      row = p.row ?? null;
    }
    out.push({ round: n, state, date: text(m, `Nc${n}Raised`) });
  }
  return last ? { key, title, group, kind, rounds: out, last, outcome, row } : null;
}

/** Every item raised in some round: the requirements, then the site exterior photos and the products. */
export function ncTracker(d: DaDetails | null): TrackItem[] {
  if (!d) return [];
  const rounds = roundNumbers(d);
  if (!rounds.length) return [];
  const items: TrackItem[] = [];
  const keyOf = (r: Row) => `${text(r, 'SectionCode')}.${text(r, 'RequirementCode')}`;
  const keys = [...new Set(d.ncRounds.flatMap((rd) => rd.requirements.map(keyOf)))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }));
  for (const key of keys) {
    const desk = d.requirements.find((r) => keyOf(r) === key);
    const any = desk ?? d.ncRounds.flatMap((rd) => rd.requirements).find((r) => keyOf(r) === key) ?? {};
    const section = d.sections.find((s) => text(s, 'SectionCode') === text(any, 'SectionCode'));
    const name = text(any, 'RequirementName');
    const code = text(any, 'SectionCode');
    const group = section
      ? t('staff.daDetails.tracker.item.parameterNamed.label', 'Parameter {code} · {name}', { code, name: text(section, 'SectionName') })
      : t('staff.daDetails.tracker.item.parameter.label', 'Parameter {code}', { code });
    const item = track(d, rounds, 'requirement', key, name ? `${key} ${name}` : key, group, (rd) => {
      const r = rd.requirements.find((x) => keyOf(x) === key);
      return { raised: !!r, decision: text(r, 'Conformance'), row: r ?? null };
    });
    if (item) items.push(item);
  }
  const photo = track(d, rounds, 'photo', 'photos', t('staff.daDetails.tracker.item.photos.label', 'Site exterior photos'),
    t('staff.daDetails.tracker.item.basicGroup.label', 'Basic information'), (rd) => {
    const p = rd.photos.find((x) => text(x, 'PhotoType') === 'SiteExteriorPhotos');
    return { raised: !!p, decision: text(p, 'IsVerified') };
  });
  if (photo) items.push(photo);
  const products = [...new Set(d.ncRounds.flatMap((rd) => rd.products.map((p) => text(p, 'ProductParentId') || text(p, 'ProductName'))))];
  for (const id of products) {
    const any = d.ncRounds.flatMap((rd) => rd.products).find((p) => (text(p, 'ProductParentId') || text(p, 'ProductName')) === id) ?? {};
    const item = track(d, rounds, 'product', 'product-' + id, t('staff.daDetails.tracker.item.product.label', 'Product: {name}', { name: text(any, 'ProductName') }),
      t('staff.daDetails.tracker.item.productGroup.label', 'Basic information · Product manufactured'), (rd) => {
        const p = rd.products.find((x) => (text(x, 'ProductParentId') || text(x, 'ProductName')) === id);
        return { raised: !!p, decision: text(p, 'IsVerified') };
      });
    if (item) items.push(item);
  }
  return items;
}

/** The basic information items the assessor did not accept at the desktop (site exterior photos, products). */
export function basicRaised(d: DaDetails | null): number {
  if (!d) return 0;
  const photo = d.photos.find((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos');
  return (text(photo, 'IsVerified') === 'No' ? 1 : 0) + d.products.filter((p) => text(p, 'IsVerified') === 'No').length;
}

/** "13 Nov 2026" from the record's dates ("November 13, 2026", ISO…); the value as given when it is not a date. */
export function shortDay(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Monthly utilisation above the monthly capacity (same unit), as staff-14d flags it. */
export function aboveCapacity(m: Row): boolean {
  const cap = num(m, 'ManufacturingCapacityValue');
  const use = num(m, 'MonthlyUtilizationValue');
  const same = text(m, 'ManufacturingCapacityUnits').trim().toLowerCase() === text(m, 'MonthlyUtilizationUnits').trim().toLowerCase();
  return cap > 0 && use > cap && same;
}
