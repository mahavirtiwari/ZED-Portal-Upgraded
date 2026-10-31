import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@zed/shared';
import { catchError, throwError } from 'rxjs';
import { apiBasePath } from './api-base';

/** Query parameter of the login pages after a session ended: they show {@link SESSION_EXPIRED_MESSAGE}. */
export const EXPIRED_PARAM = 'expired';
export const RETURN_PARAM = 'returnUrl';
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

/**
 * A 401 from this portal's own API while signed in: the session ended on the server (timed out, password changed,
 * blocked). The page forgets the user and opens its login page with a note and the way back, instead of showing
 * "Unexpected error" on every Save. Sign-in calls are left alone, and so are the other portals' APIs the Admin
 * switches to (their interceptor signs in there again).
 */
export const sessionExpiryInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const own = apiBasePath() + '/api/';
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && req.url.startsWith(own) && !req.url.includes('/auth/')) {
        const user = auth.currentUser();
        if (user) {
          auth.forget();
          const msme = user.roleId === 5;
          const login = msme ? '/msme/login' : '/login';
          if (!router.url.startsWith(login)) {
            void router.navigate([login], { queryParams: { [EXPIRED_PARAM]: 1, [RETURN_PARAM]: router.url } });
          }
        }
      }
      return throwError(() => err);
    }),
  );
};

/** Where to go after signing in again: the page the session ended on, when it is one of this area's own pages. */
export function returnUrl(value: string | null | undefined, area: '/staff' | '/msme/'): string | null {
  return value && value.startsWith(area) && !value.startsWith('//') && !value.includes('://') ? value : null;
}
