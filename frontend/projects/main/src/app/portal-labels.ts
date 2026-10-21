import { PORTAL_SYSTEM, PortalSystem } from './portal-system';

/** Wording that differs between the three portals (titles, and what agencies and assessors are called). */
export interface PortalLabels {
  /** Name of the portal in the header and the browser title. */
  portalName: string;
  loginTitle: string;
  /** RoleId 2. */
  agency: string;
  agencies: string;
  /** RoleId 3 (and, on Consultancy, the technical experts, RoleId 33). */
  assessor: string;
  assessors: string;
}

export const LABELS: Record<PortalSystem, PortalLabels> = {
  main: {
    portalName: 'MSME Sustainable (ZED) Certification',
    loginTitle: 'ZED | User Login',
    agency: 'Assessment Agency',
    agencies: 'Assessment Agencies',
    assessor: 'Assessor',
    assessors: 'Assessors',
  },
  consultancy: {
    portalName: 'ZED Handholding Support',
    loginTitle: 'ZED Consultancy | User Login',
    agency: 'Consultant Organisation',
    agencies: 'Consultant Organisations',
    assessor: 'Consultant/Expert',
    assessors: 'Consultants/Experts',
  },
  surveillance: {
    portalName: 'ZED Surveillance',
    loginTitle: 'ZED Surveillance | User Login',
    agency: 'Surveillance Agency',
    agencies: 'Bronze Surveillance Agencies',
    assessor: 'Assessor',
    assessors: 'Assessors',
  },
};

/** Labels of this build. */
export const PORTAL_LABELS: PortalLabels = LABELS[PORTAL_SYSTEM];
