/**
 * New in V4 (docs/mobile/ZEDX-MSME-APP.md): ZED-X, the level the Admin enables in Administration → Certification Levels.
 * The server's list of enabled levels (api/public/levels) decides whether the app shows it.
 */
import type { PublicLevel } from './api';
import { certificationDetailsOf, type MsmeStatus } from './models';

/** The Admin's ZED-X, or null when it is not enabled (or the server has never answered on this phone). */
export const zedxLevel = (levels: PublicLevel[] | null | undefined): PublicLevel | null =>
  levels?.find(l => l.code?.toUpperCase() === 'ZEDX') ?? null;

/**
 * ZED-X's card is shown once the Admin has enabled the level, and always once the unit has paid for it (so that work in
 * progress stays reachable if the level is switched off or the phone has never had the level list).
 */
export function showZedx(levels: PublicLevel[] | null | undefined, status: MsmeStatus | null | undefined): boolean {
  return zedxLevel(levels) != null || (certificationDetailsOf(status, 'ZEDX')?.status ?? 0) >= 1;
}
