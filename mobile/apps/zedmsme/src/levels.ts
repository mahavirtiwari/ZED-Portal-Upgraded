/**
 * New in V4 (docs/mobile/ZEDX-MSME-APP.md): ZED-X, the level the Admin enables in Administration → Certification Levels.
 * The server's list of enabled levels (api/public/levels) decides whether the app shows it.
 * 2026-11-08 (generic levels): the levels the Admin adds there (e.g. PLATINUM) work as ZED-X does.
 */
import type { ImageSourcePropType } from 'react-native';
import type { PublicLevel } from './api';
import { useMsme } from './app/context';
import { images } from './assets/images';
import { certificationDetailsOf, isLegacyLevel, levelName, sameLevel, type CertificationType, type MsmeStatus } from './models';

/** The Admin's level of this code from the enabled list (any case), or null when it is not enabled or not known. */
export const publicLevel = (levels: PublicLevel[] | null | undefined, code: string): PublicLevel | null =>
  levels?.find(l => sameLevel(l.code, code)) ?? null;

/** The Admin's ZED-X, or null when it is not enabled (or the server has never answered on this phone). */
export const zedxLevel = (levels: PublicLevel[] | null | undefined): PublicLevel | null => publicLevel(levels, 'ZEDX');

/**
 * ZED-X's card is shown once the Admin has enabled the level, and always once the unit has paid for it (so that work in
 * progress stays reachable if the level is switched off or the phone has never had the level list).
 */
export function showZedx(levels: PublicLevel[] | null | undefined, status: MsmeStatus | null | undefined): boolean {
  return zedxLevel(levels) != null || (certificationDetailsOf(status, 'ZEDX')?.status ?? 0) >= 1;
}

/** A level the Admin added (not Bronze / Silver / Gold / ZED-X) as the app shows it. */
export type AddedLevel = { code: string; name: string; logoUrl: string | null; assessmentMode: string | null };

const isAdded = (code: string | null | undefined): code is string => !!code && !isLegacyLevel(code) && !sameLevel(code, 'ZEDX');

/**
 * The levels the Admin added whose cards are shown, by ZED-X's rule: enabled ones (in the server's order), and one switched
 * off (or not in this phone's list) only once the unit has paid for it. Name, logo and mode from the enabled list, else from
 * the unit's status.
 */
export function addedLevels(levels: PublicLevel[] | null | undefined, status: MsmeStatus | null | undefined): AddedLevel[] {
  const out: AddedLevel[] = [];
  const has = (code: string) => out.some(o => sameLevel(o.code, code));
  for (const l of levels ?? []) {
    if (!isAdded(l.code) || has(l.code)) continue;
    const own = status?.levels?.find(s => sameLevel(s.code, l.code));
    out.push({ code: own?.code || l.code, name: l.name?.trim() || own?.name?.trim() || l.code, logoUrl: l.logoUrl ?? null, assessmentMode: l.assessmentMode ?? own?.assessmentMode ?? null });
  }
  for (const s of status?.levels ?? []) {
    if (!isAdded(s.code) || has(s.code) || (s.status ?? 0) < 1) continue;
    out.push({ code: s.code, name: s.name?.trim() || s.code, logoUrl: null, assessmentMode: s.assessmentMode ?? null });
  }
  return out;
}

/**
 * The level's name on screen: Bronze / Silver / Gold as they are; ZED-X and the added levels with the Admin's name (the
 * enabled list, else the unit's status), else "ZED-X" or the code.
 */
export function levelDisplayName(type: CertificationType, levels: PublicLevel[] | null | undefined, status: MsmeStatus | null | undefined): string {
  if (isLegacyLevel(type)) return levelName(type);
  return levelName(type, publicLevel(levels, type)?.name || status?.levels?.find(l => sameLevel(l.code, type))?.name);
}

/** {@link levelDisplayName} for the signed-in unit. */
export function useLevelName(type: CertificationType): string {
  const app = useMsme();
  return levelDisplayName(type, app.levels, app.user?.MsmeDetails?.msmeStatus);
}

/** React Native's Image does not draw SVG (the portal's built-in ZED-X badge is zedx.svg): the app's own badge instead. */
const drawable = (url: string | null | undefined): url is string => !!url && !/\.svg(\?|#|$)/i.test(url);

/**
 * The picture of ZED-X or of a level the Admin added: the Admin's logo, else ZED-X's badge for ZED-X and the ZED logo for
 * an added level.
 */
export function v4LevelImage(type: CertificationType, levels: PublicLevel[] | null | undefined, logoUrl: (url: string) => string): ImageSourcePropType {
  const logo = publicLevel(levels, type)?.logoUrl;
  if (drawable(logo)) return { uri: logoUrl(logo) };
  return sameLevel(type, 'ZEDX') ? images.zedx : images.main_logo;
}
