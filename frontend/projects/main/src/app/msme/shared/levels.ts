/**
 * Names and built-in pictures of the certification levels by code (ZEDX is ZED-X; Administration → Certification Levels
 * can give a level its own name and logo, which the dashboard reads from api/public/levels).
 */
export const LEVEL_NAMES: Readonly<Record<string, string>> = { ZEDX: 'ZED-X' };

export function levelName(code: string | null | undefined): string {
  return code ? (LEVEL_NAMES[code] ?? code) : '';
}

export function levelLogo(code: string): string {
  return code === 'ZEDX' ? '/Images/Dashboard/zedx.svg' : `/Images/Dashboard/${code.toLowerCase()}.png`;
}
