import { PORTAL_SYSTEM, PortalSystem } from './portal-system';
import { t } from './content/page-text';

/** Wording that differs between the three portals (titles, and what agencies and assessors are called). */
export interface PortalLabels {
  /** Name of the portal in the header and the browser title. */
  readonly portalName: string;
  readonly loginTitle: string;
  /** RoleId 2. */
  readonly agency: string;
  readonly agencies: string;
  /** RoleId 3 (and, on Consultancy, the technical experts, RoleId 33). */
  readonly assessor: string;
  readonly assessors: string;
}

/**
 * 2026-11-19 ("All page wording"): the shared vocabulary is page wording the Admin can change (Administration → Texts → Page
 * wording, "Every page"), one key per portal. Each label is read when it is used (a getter), so a computed() or template that
 * shows it follows the Admin's wording; a value copied into a class field keeps the standard wording.
 */
export const LABELS: Record<PortalSystem, PortalLabels> = {
  main: {
    get portalName() { return t('common.portal.main.title', 'MSME Sustainable (ZED) Certification'); },
    get loginTitle() { return t('common.portal.main.loginTitle', 'ZED | User Login'); },
    get agency() { return t('common.portal.main.agencyLabel', 'Assessment Agency'); },
    get agencies() { return t('common.portal.main.agenciesLabel', 'Assessment Agencies'); },
    get assessor() { return t('common.portal.main.assessorLabel', 'Assessor'); },
    get assessors() { return t('common.portal.main.assessorsLabel', 'Assessors'); },
  },
  consultancy: {
    get portalName() { return t('common.portal.consultancy.title', 'ZED Handholding Support'); },
    get loginTitle() { return t('common.portal.consultancy.loginTitle', 'ZED Consultancy | User Login'); },
    get agency() { return t('common.portal.consultancy.agencyLabel', 'Consultant Organisation'); },
    get agencies() { return t('common.portal.consultancy.agenciesLabel', 'Consultant Organisations'); },
    get assessor() { return t('common.portal.consultancy.assessorLabel', 'Consultant/Expert'); },
    get assessors() { return t('common.portal.consultancy.assessorsLabel', 'Consultants/Experts'); },
  },
  surveillance: {
    get portalName() { return t('common.portal.surveillance.title', 'ZED Surveillance'); },
    get loginTitle() { return t('common.portal.surveillance.loginTitle', 'ZED Surveillance | User Login'); },
    get agency() { return t('common.portal.surveillance.agencyLabel', 'Surveillance Agency'); },
    get agencies() { return t('common.portal.surveillance.agenciesLabel', 'Bronze Surveillance Agencies'); },
    get assessor() { return t('common.portal.surveillance.assessorLabel', 'Assessor'); },
    get assessors() { return t('common.portal.surveillance.assessorsLabel', 'Assessors'); },
  },
};

/** Labels of this build. */
export const PORTAL_LABELS: PortalLabels = LABELS[PORTAL_SYSTEM];
