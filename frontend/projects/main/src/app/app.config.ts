import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { EnvironmentTitleStrategy, provideZedHttp } from '@zed/shared';
import { apiBaseInterceptor } from './api-base';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideZedHttp([apiBaseInterceptor]),
    // Route titles get the test-environment prefix (Portal:EnvironmentLabel) when one is set.
    { provide: TitleStrategy, useClass: EnvironmentTitleStrategy },
  ],
};
