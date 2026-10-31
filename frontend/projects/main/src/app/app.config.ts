import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideZedHttp } from '@zed/shared';
import { apiBaseInterceptor } from './api-base';
import { adminPortalInterceptor } from './staff/admin-portal';
import { sessionExpiryInterceptor } from './session-expiry';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideZedHttp([adminPortalInterceptor, apiBaseInterceptor, sessionExpiryInterceptor]),
  ],
};
