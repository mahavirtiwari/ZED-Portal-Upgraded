import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideZedHttp } from '@zed/shared';
import { apiBaseInterceptor } from './api-base';
import { adminPortalInterceptor } from './staff/admin-portal';
import { sessionExpiryInterceptor } from './session-expiry';
import { routes } from './app.routes';
import { PublicLevels } from './msme/shared/levels';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideZedHttp([adminPortalInterceptor, apiBaseInterceptor, sessionExpiryInterceptor]),
    // The Admin's level names and logos (Certification Levels), without holding up the start.
    provideAppInitializer(() => {
      void inject(PublicLevels).load();
    }),
  ],
};
