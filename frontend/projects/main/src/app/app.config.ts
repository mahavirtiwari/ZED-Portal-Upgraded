import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideZedHttp } from '@zed/shared';
import { apiBaseInterceptor } from './api-base';
import { adminPortalInterceptor } from './staff/admin-portal';
import { sessionExpiryInterceptor } from './session-expiry';
import { routes } from './app.routes';
import { PublicLevels } from './msme/shared/levels';
import { PublicStates } from './msme/shared/states';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideZedHttp([adminPortalInterceptor, apiBaseInterceptor, sessionExpiryInterceptor]),
    // The Admin's level names and logos (Certification Levels), without holding up the start.
    // 2026-11-08: also every level, enabled or not (staff filters, menus and tables; levels the Admin added).
    provideAppInitializer(() => {
      const levels = inject(PublicLevels);
      void levels.load();
      void levels.loadAll();
    }),
    // The states of the LG Directory masters for the state drop-downs (waits at most 3 seconds, else the built-in list).
    provideAppInitializer(() => inject(PublicStates).load()),
  ],
};
