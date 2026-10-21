import { Routes } from '@angular/router';

/**
 * Technology Upgradation (TU) review and the technology recommendation of the consultancy portal, mounted at
 * /staff/consultancy/technology (app.routes.ts: { path: 'consultancy/technology', loadChildren: ... TECHNOLOGY_ROUTES }).
 */
export const TECHNOLOGY_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'ZED | Technology Upgradation',
    loadComponent: () => import('./tu-submissions').then((m) => m.TuSubmissionsPage),
  },
  {
    path: 'verification/:zedId/:level',
    title: 'ZED | Technology Upgradation',
    loadComponent: () => import('./tu-verification').then((m) => m.TuVerificationPage),
  },
  {
    path: ':zedId/:level',
    title: 'ZED | Recommended Technologies',
    loadComponent: () => import('./technology-recommendation').then((m) => m.TechnologyRecommendationPage),
  },
];
