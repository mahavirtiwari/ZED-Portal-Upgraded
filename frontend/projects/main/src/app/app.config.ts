import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideZedHttp } from '@zed/shared';
import { apiBaseInterceptor } from './api-base';
import { adminPortalInterceptor } from './staff/admin-portal';
import { sessionExpiryInterceptor } from './session-expiry';
import { MaintenanceService, maintenanceInterceptor } from './maintenance';
import { BrandingService } from './branding';
import { routes } from './app.routes';
import { PublicLevels } from './msme/shared/levels';
import { PublicStates } from './msme/shared/states';
import { ContentService } from './content/content-text';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideZedHttp([adminPortalInterceptor, apiBaseInterceptor, sessionExpiryInterceptor, maintenanceInterceptor]),
    // 2026-11-15: Maintenance mode: whether this portal is down, without holding up the start.
    provideAppInitializer(() => {
      void inject(MaintenanceService).check();
    }),
    // 2026-11-15: the Admin's logos and colour theme (Branding), without holding up the start.
    provideAppInitializer(() => {
      void inject(BrandingService).load();
    }),
    // The Admin's level names and logos (Certification Levels), without holding up the start.
    // 2026-11-08: also every level, enabled or not (staff filters, menus and tables; levels the Admin added).
    provideAppInitializer(() => {
      const levels = inject(PublicLevels);
      void levels.load();
      void levels.loadAll();
    }),
    // 2026-11-19: the Admin's Texts and page wording (one api/content call), without holding up the start: pages show their
    // own wording until it arrives (content/page-text.ts).
    provideAppInitializer(() => {
      inject(ContentService).preload();
    }),
    // The states of the LG Directory masters for the state drop-downs (waits at most 3 seconds, else the built-in list).
    provideAppInitializer(() => inject(PublicStates).load()),
  ],
};
