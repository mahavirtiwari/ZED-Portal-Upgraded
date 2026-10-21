import { Routes } from '@angular/router';

/** Children of the signed-in `msme` route (inside the MSME layout). */
export const MSME_SCHEME_ROUTES: Routes = [
  {
    path: 'financial-assistance',
    title: 'ZED | Financial Assistance',
    loadComponent: () => import('./financial-assistance').then((m) => m.FinancialAssistancePage),
  },
  {
    path: 'technology-upgradation',
    title: 'ZED | Technology Upgradation',
    loadComponent: () => import('./technology-upgradation').then((m) => m.TechnologyUpgradationPage),
  },
];

/** Public pages (no sign-in, own header), top level. */
export const PUBLIC_INCENTIVE_ROUTES: Routes = [
  { path: 'incentives', pathMatch: 'full', title: 'ZED | Incentives', loadComponent: () => import('./incentives').then((m) => m.PublicIncentivesPage) },
  {
    path: 'incentives/mobile',
    title: 'ZED | Incentives',
    data: { mobile: true },
    loadComponent: () => import('./incentives').then((m) => m.PublicIncentivesPage),
  },
  {
    path: 'incentives/submissions',
    title: 'ZED | Incentives Submitted',
    loadComponent: () => import('./incentive-submissions').then((m) => m.PublicIncentiveSubmissionsPage),
  },
];

function incentiveQuery(stateId: string | undefined, q: Record<string, string>): string {
  const params = new URLSearchParams();
  const id = stateId ?? q['id'];
  if (q['ct']) params.set('ct', q['ct']);
  if (id) params.set('id', id);
  if (q['it']) params.set('it', q['it']);
  if (q['msmeSize']) params.set('msmeSize', q['msmeSize']);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Old MVC addresses. Incentive/Details/{StateId}?ct= is built by SP_MSME_GET_DETAILS (certification pages),
 * SP_APP_MSME_CHECK_LOGIN and SP_APP_MSME_STATUS (mobile app) from UrlsMasterData, so it must keep working.
 */
export const SCHEME_LEGACY_REDIRECTS: Routes = [
  { path: 'FinancialAssistance', pathMatch: 'full', redirectTo: 'msme/financial-assistance' },
  { path: 'FinancialAssistance/Index', redirectTo: 'msme/financial-assistance' },
  { path: 'FinancialAssistance/Details', redirectTo: 'msme/financial-assistance' },
  { path: 'TechnologyUpgradation', pathMatch: 'full', redirectTo: 'msme/technology-upgradation' },
  { path: 'TechnologyUpgradation/Index', redirectTo: 'msme/technology-upgradation' },
  { path: 'Incentive/Details/:id', redirectTo: ({ params, queryParams }) => `/incentives${incentiveQuery(params['id'], queryParams)}` },
  { path: 'Incentive/Details', redirectTo: ({ queryParams }) => `/incentives${incentiveQuery(undefined, queryParams)}` },
  { path: 'Incentive/DetailsMobile/:id', redirectTo: ({ params, queryParams }) => `/incentives/mobile${incentiveQuery(params['id'], queryParams)}` },
  { path: 'Incentive/DetailsMobile', redirectTo: ({ queryParams }) => `/incentives/mobile${incentiveQuery(undefined, queryParams)}` },
  { path: 'Incentive/SubmissionsPublic/:id', redirectTo: ({ params, queryParams }) => `/incentives/submissions${incentiveQuery(params['id'], queryParams)}` },
  { path: 'Incentive/SubmissionsPublic', redirectTo: ({ queryParams }) => `/incentives/submissions${incentiveQuery(undefined, queryParams)}` },
];

export { incentiveQuery };
