import { Routes } from '@angular/router';
import { authGuard } from '@zed/shared';
import { StaffRole } from '../staff-menu';

const admin = authGuard('/staff', [StaffRole.Admin]);

/** Admin settings (children of `staff`, mounted at `staff/settings`). The API checks the role again. */
export const SETTINGS_ROUTES: Routes = [
  // New in V4: where "Contact ZED" goes.
  { path: 'links', title: 'ZED | Links', canActivate: [admin], loadComponent: () => import('./links').then((m) => m.LinksPage) },
  // New in V4: the certification levels' boxes (ZED-X included) and their certificate settings.
  { path: 'levels', title: 'ZED | Certification Levels', canActivate: [admin], loadComponent: () => import('./certification-levels').then((m) => m.CertificationLevelsPage) },
  {
    path: 'captcha',
    title: 'ZED | Captcha Settings',
    canActivate: [admin],
    loadComponent: () => import('./captcha-settings').then((m) => m.CaptchaSettingsPage),
  },
  // 2026-11-13: how agencies' certified professionals are verified (per portal, through the portal switch).
  {
    path: 'professional-verification',
    title: 'ZED | Professional Verification',
    canActivate: [admin],
    loadComponent: () => import('./professional-verification').then((m) => m.ProfessionalVerificationPage),
  },
  // 2026-11-15: the logos and colour themes of each portal and app (main portal; the API refuses the others).
  {
    path: 'branding',
    title: 'ZED | Branding',
    canActivate: [admin],
    loadComponent: () => import('./branding').then((m) => m.BrandingPage),
  },
  // 2026-11-15: each portal and app up or down (main portal; the API refuses the others).
  {
    path: 'maintenance',
    title: 'ZED | Maintenance mode',
    canActivate: [admin],
    loadComponent: () => import('./maintenance-mode').then((m) => m.MaintenanceModePage),
  },
  // New in V4: the CCAvenue account and the invoice switch (main portal; the API refuses the others).
  {
    path: 'payment-gateway',
    title: 'ZED | Payment Gateway and Invoices',
    canActivate: [admin],
    loadComponent: () => import('./payment-gateway').then((m) => m.PaymentGatewayPage),
  },
  {
    path: 'email',
    title: 'ZED | Email Settings',
    canActivate: [admin],
    loadComponent: () => import('./email-settings').then((m) => m.EmailSettingsPage),
  },
  {
    // 2026-11-21: the server's own log (Zed.Core.Logging), each portal's through the portal switch.
    path: 'server-logs',
    title: 'ZED | Server Logs',
    canActivate: [admin],
    loadComponent: () => import('./server-logs').then((m) => m.ServerLogsPage),
  },
  {
    path: 'email-templates',
    title: 'ZED | Email Templates',
    canActivate: [admin],
    loadComponent: () => import('./email-templates').then((m) => m.EmailTemplatesPage),
  },
  {
    path: 'texts',
    title: 'ZED | Texts',
    canActivate: [admin],
    loadComponent: () => import('./texts').then((m) => m.TextsPage),
  },
  {
    path: 'app-forms',
    title: 'ZED | App Forms',
    canActivate: [admin],
    loadComponent: () => import('./app-forms').then((m) => m.AppFormsPage),
  },
  // 2026-11-17 (approved): the checklists ticked before a final submit / quality check, and the observation reasons.
  {
    path: 'submission-checklists',
    title: 'ZED | Submission Checklists',
    canActivate: [admin],
    loadComponent: () => import('./submission-checklists').then((m) => m.SubmissionChecklistsPage),
  },
  {
    path: 'observation-reasons',
    title: 'ZED | Observation Reasons',
    canActivate: [admin],
    loadComponent: () => import('./observation-reasons').then((m) => m.ObservationReasonsPage),
  },
  // 2026-11-19 (approved): the reasons an agency picks when it rejects a unit allotted to it (main and surveillance).
  {
    path: 'rejection-reasons',
    title: 'ZED | Rejection Reasons',
    canActivate: [admin],
    loadComponent: () => import('./rejection-reasons').then((m) => m.RejectionReasonsPage),
  },
  // 2026-11-18: turnaround times per status and between statuses (per portal, through the portal switch).
  { path: 'tat', title: 'ZED | TAT', canActivate: [admin], loadComponent: () => import('./tat').then((m) => m.TatPage) },
  // New in V4: the site tour sections of the site assessor app and the photos each needs.
  {
    path: 'site-tour-sections',
    title: 'ZED | Site Tour Sections',
    canActivate: [admin],
    loadComponent: () => import('./site-tour-sections').then((m) => m.SiteTourSectionsPage),
  },
  {
    path: 'esg-checklist',
    title: 'ZED | ESG Checklist',
    canActivate: [admin],
    loadComponent: () => import('./esg-checklist').then((m) => m.EsgChecklistPage),
  },
  {
    path: 'api-integrations',
    title: 'ZED | API Integrations',
    canActivate: [admin],
    loadComponent: () => import('./api-integrations').then((m) => m.ApiIntegrationsPage),
  },
];
