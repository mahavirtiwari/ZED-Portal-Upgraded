import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** A level as the Admin set it (api/public/levels: the enabled ones). */
export interface PublicLevelInfo {
  code: string;
  name: string;
  logoUrl: string | null;
  assessmentMode?: 'Desktop' | 'Site';
  /** 2026-11-14: Desktop | Remote | Onsite | DesktopRemote | DesktopOnsite (the level's steps). */
  assessmentFlow?: string | null;
  surveillanceMode?: string | null;
}

/** Every level, enabled or not (api/public/levels/all), for staff filters, menus and tables with old records. */
export interface LevelInfo {
  code: string;
  name: string;
  isEnabled: boolean;
  assessmentMode: 'Desktop' | 'Site';
  logoUrl: string | null;
  orderNo: number;
}

/** The built-in names (ZEDX is ZED-X) until the Admin's arrive. */
const BUILT_IN_NAMES: Readonly<Record<string, string>> = { ZEDX: 'ZED-X' };

/** The built-in levels until api/public/levels/all answers (and in specs). */
export const BUILT_IN_LEVELS: readonly LevelInfo[] = [
  { code: 'Bronze', name: 'Bronze', isEnabled: true, assessmentMode: 'Desktop', logoUrl: null, orderNo: 10 },
  { code: 'Silver', name: 'Silver', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 20 },
  { code: 'Gold', name: 'Gold', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 30 },
  { code: 'ZEDX', name: 'ZED-X', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 40 },
];

const names = signal<Record<string, string>>({ ...BUILT_IN_NAMES });
const logos = signal<Record<string, string>>({});
const all = signal<readonly LevelInfo[]>(BUILT_IN_LEVELS);
/** True once api/public/levels/all answered: a code not in the list is then not a level. */
const allLoaded = signal(false);

/** @deprecated The names now follow Administration → Certification Levels; use levelName(). */
export const LEVEL_NAMES: Readonly<Record<string, string>> = BUILT_IN_NAMES;

/**
 * Names and pictures of the certification levels by code (2026-11-08: the Admin's names and logos from api/public/levels,
 * loaded once per page load by PublicLevels; built-in until then). Read inside a template, a change re-draws it.
 */
export function levelName(code: string | null | undefined): string {
  if (!code) return '';
  const n = names();
  return n[code] ?? n[Object.keys(n).find((k) => k.toLowerCase() === code.toLowerCase()) ?? ''] ?? code;
}

export function levelLogo(code: string): string {
  return logos()[code] ?? (code === 'ZEDX' ? '/Images/Dashboard/zedx.svg' : `/Images/Dashboard/${code.toLowerCase()}.png`);
}

/** Bronze, Silver and Gold: the legacy levels with their own flows (MSME app, legacy procedures); any case. */
export function isLegacyLevel(code: string | null | undefined): boolean {
  const c = (code ?? '').toLowerCase();
  return c === 'bronze' || c === 'silver' || c === 'gold';
}

/**
 * A V4 level: ZED-X and every level the Admin adds (Administration → Certification Levels). They work as ZED-X does: applied
 * for and paid on the web, basic information and documents entered on the web, allotted automatically.
 */
export function isV4Level(code: string | null | undefined): boolean {
  return !!code && /^[A-Za-z][A-Za-z0-9]{1,19}$/.test(code) && !isLegacyLevel(code);
}

/**
 * Every level (api/public/levels/all, in the Admin's order), enabled or not; the built-in four until it answers. Read inside
 * a template or computed, a change re-draws it.
 */
export function allLevels(): readonly LevelInfo[] {
  return all();
}

/** The codes of every level (or of the enabled ones), in the Admin's order. */
export function levelCodes(enabledOnly = false): string[] {
  return all().filter((l) => !enabledOnly || l.isEnabled).map((l) => l.code);
}

/** The level's assessment: Desktop (as Bronze) or desktop and Site (as Silver / Gold). */
export function levelMode(code: string | null | undefined): 'Desktop' | 'Site' {
  const c = (code ?? '').toLowerCase();
  return all().find((l) => l.code.toLowerCase() === c)?.assessmentMode ?? (c === 'bronze' ? 'Desktop' : 'Site');
}

/** { value: code, label: name } of every level, for the filters. */
export function levelOptions(enabledOnly = false): { value: string; label: string }[] {
  return all().filter((l) => !enabledOnly || l.isEnabled).map((l) => ({ value: l.code, label: levelName(l.code) || l.name }));
}

/**
 * The level's code as stored (the Admin's spelling) for a value from an address, any case; null when it is not a level
 * (api/public/levels/all; the built-in four until it answers, a change re-checks a computed that reads it).
 */
export function canonicalLevelCode(value: string | null | undefined, filter?: (l: LevelInfo) => boolean): string | null {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return null;
  return (filter ? all().filter(filter) : all()).find((l) => l.code.toLowerCase() === v)?.code ?? null;
}

/**
 * "PlatinumSurveillance" → { level: 'PLATINUM', suffix: 'Surveillance' }; "GoldMilestone2" → { level: 'Gold', suffix: 'Milestone2' };
 * null when the level is not one.
 */
export function splitCertification(value: string | null | undefined): { level: string; suffix: string } | null {
  const m = /^(.*?)(Surveillance|Milestone\d)?$/i.exec((value ?? '').trim());
  if (!m) return null;
  const level = canonicalLevelCode(m[1]);
  if (!level) return null;
  const s = (m[2] ?? '').toLowerCase();
  const suffix = s === 'surveillance' ? 'Surveillance' : s ? `Milestone${s.slice(-1)}` : '';
  return { level, suffix };
}

/** The Admin's enabled levels (api/public/levels), loaded once; the login pages' chips and the level names use them. */
@Injectable({ providedIn: 'root' })
export class PublicLevels {
  private readonly http = inject(HttpClient);
  private loading: Promise<void> | null = null;
  private loadingAll: Promise<void> | null = null;
  readonly levels = signal<PublicLevelInfo[] | null>(null);
  /** The enabled levels' names, in the Admin's order (null until loaded). */
  readonly names = computed(() => this.levels()?.map((l) => l.name) ?? null);

  load(): Promise<void> {
    this.loading ??= firstValueFrom(this.http.get<PublicLevelInfo[]>('/api/public/levels'))
      .then((list) => {
        this.levels.set(list);
        names.update((n) => ({ ...BUILT_IN_NAMES, ...n, ...Object.fromEntries(list.map((l) => [l.code, l.name])) }));
        // Until (or without) api/public/levels/all: the enabled levels the Admin added are levels too.
        if (!allLoaded()) {
          const known = new Set(all().map((l) => l.code.toLowerCase()));
          const added = list.filter((l) => !known.has(l.code.toLowerCase()))
            .map((l, i) => ({ code: l.code, name: l.name, isEnabled: true, assessmentMode: l.assessmentMode === 'Desktop' ? 'Desktop' as const : 'Site' as const, logoUrl: l.logoUrl, orderNo: 1000 + i }));
          if (added.length) all.set([...all(), ...added]);
        }
        logos.update((g) => ({ ...g, ...Object.fromEntries(list.filter((l) => !!l.logoUrl).map((l) => [l.code, l.logoUrl!])) }));
      })
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** Every level, enabled or not (api/public/levels/all), for staff filters, menus and tables; once per page load. */
  loadAll(): Promise<void> {
    this.loadingAll ??= firstValueFrom(this.http.get<LevelInfo[]>('/api/public/levels/all'))
      .then((list) => setAllLevels(list))
      .catch(() => {
        this.loadingAll = null;
      });
    return this.loadingAll;
  }
}

/** Sets every level (api/public/levels/all's answer); also used by specs. */
export function setAllLevels(list: readonly LevelInfo[] | null): void {
  if (!list) {
    all.set(BUILT_IN_LEVELS);
    allLoaded.set(false);
    names.set({ ...BUILT_IN_NAMES });
    logos.set({});
    return;
  }
  const sorted = [...list].sort((a, b) => (a.orderNo ?? 0) - (b.orderNo ?? 0));
  all.set(sorted.length ? sorted : BUILT_IN_LEVELS);
  allLoaded.set(sorted.length > 0);
  names.update((n) => ({ ...n, ...Object.fromEntries(sorted.map((l) => [l.code, l.name])) }));
  logos.update((g) => ({ ...g, ...Object.fromEntries(sorted.filter((l) => !!l.logoUrl).map((l) => [l.code, l.logoUrl!])) }));
}
