import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** A level as the Admin set it (api/public/levels: the enabled ones). */
export interface PublicLevelInfo {
  code: string;
  name: string;
  logoUrl: string | null;
}

/** The built-in names (ZEDX is ZED-X) until the Admin's arrive. */
const BUILT_IN_NAMES: Readonly<Record<string, string>> = { ZEDX: 'ZED-X' };

const names = signal<Record<string, string>>({ ...BUILT_IN_NAMES });
const logos = signal<Record<string, string>>({});

/** @deprecated The names now follow Administration → Certification Levels; use levelName(). */
export const LEVEL_NAMES: Readonly<Record<string, string>> = BUILT_IN_NAMES;

/**
 * Names and pictures of the certification levels by code (2026-11-08: the Admin's names and logos from api/public/levels,
 * loaded once per page load by PublicLevels; built-in until then). Read inside a template, a change re-draws it.
 */
export function levelName(code: string | null | undefined): string {
  return code ? (names()[code] ?? code) : '';
}

export function levelLogo(code: string): string {
  return logos()[code] ?? (code === 'ZEDX' ? '/Images/Dashboard/zedx.svg' : `/Images/Dashboard/${code.toLowerCase()}.png`);
}

/** The Admin's enabled levels (api/public/levels), loaded once; the login pages' chips and the level names use them. */
@Injectable({ providedIn: 'root' })
export class PublicLevels {
  private readonly http = inject(HttpClient);
  private loading: Promise<void> | null = null;
  readonly levels = signal<PublicLevelInfo[] | null>(null);
  /** The enabled levels' names, in the Admin's order (null until loaded). */
  readonly names = computed(() => this.levels()?.map((l) => l.name) ?? null);

  load(): Promise<void> {
    this.loading ??= firstValueFrom(this.http.get<PublicLevelInfo[]>('/api/public/levels'))
      .then((list) => {
        this.levels.set(list);
        names.set({ ...BUILT_IN_NAMES, ...Object.fromEntries(list.map((l) => [l.code, l.name])) });
        logos.set(Object.fromEntries(list.filter((l) => !!l.logoUrl).map((l) => [l.code, l.logoUrl!])));
      })
      .catch(() => {
        this.loading = null;
      });
    return this.loading;
  }
}
