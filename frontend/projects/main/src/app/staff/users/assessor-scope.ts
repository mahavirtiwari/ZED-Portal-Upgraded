/** 2026-11-14 (approved): one kind of assessor, ticked for the levels and modes it may do (Users.AssessmentModes). */
export interface ScopeItem {
  level: string;
  modes: string[];
}

/** The assessor may take the level in this mode; an assessor without ticks in the answer (surveillance) is not limited. */
export function mayAssess(a: { assessments?: ScopeItem[] | null }, level: string, mode: 'Desktop' | 'Remote' | 'Onsite'): boolean {
  if (!a.assessments) return true;
  const l = level.trim().toLowerCase();
  return a.assessments.some((x) => x.level.toLowerCase() === l && x.modes.includes(mode));
}

/** "Bronze: Desktop", "Silver: Desktop, Onsite" for the lists. */
export function scopeChips(items: ScopeItem[] | null | undefined): string[] {
  return (items ?? []).filter((x) => x.modes.length).map((x) => `${x.level === 'ZEDX' ? 'ZED-X' : x.level}: ${x.modes.join(', ')}`);
}
