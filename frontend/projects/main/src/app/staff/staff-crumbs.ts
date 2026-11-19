import { Crumb } from '../msme/shared/page-head';
import { t } from '../content/page-text';

export type { Crumb };

/**
 * 2026-11-17 (approved staff redesign): the first crumb of a staff page, "Home", as the menu bar's Home: /staff, which opens
 * the role's landing page (the dashboard for Master Admin, agencies, assessors, Ministry...).
 */
export const STAFF_HOME: Crumb = { get label() { return t('staff.layout.crumb.home', 'Home'); }, link: '/staff' };

/** "Home > … > the page" for <code>zed-page-head</code>: <code>staffCrumbs({ label: 'Assessment Agencies' })</code>. */
export function staffCrumbs(...rest: Crumb[]): Crumb[] {
  return [STAFF_HOME, ...rest];
}
