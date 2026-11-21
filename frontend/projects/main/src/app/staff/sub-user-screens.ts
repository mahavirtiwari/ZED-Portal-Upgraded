import { Component, inject } from '@angular/core';
import { ActivatedRoute, CanActivateChildFn, Router, RouterLink } from '@angular/router';
import { AuthService } from '@zed/shared';
import { TextPipe } from '../content/page-text';
import { menuFor } from './staff-menu';

/**
 * 2026-11-21 (Operation Admin audit): a sub-user (operation admin, agency sub-user) opening a screen of its owner's menu that it
 * was not given (`permissionRoutes`) gets one clean "no access" page instead of the screen's controls around a refusal banner.
 * Only the owner's menu screens are checked (the longest matching menu route): the pages opened from a screen (details,
 * reports) and the always-readable ones (home dashboard, MSME profile) stay open; the API checks every call again.
 */
export function blockedScreen(path: string, roleId: number, subRoles: readonly string[], granted: readonly string[] | null | undefined): string | null {
  if (!granted) return null;
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '');
  const screen = menuFor(roleId, subRoles, undefined, null)
    .map((i) => i.route)
    .filter((r): r is string => !!r && r !== '/staff' && r.startsWith('/staff/') && (clean === r || clean.startsWith(r + '/')))
    .sort((a, b) => b.length - a.length)[0];
  if (!screen || ALWAYS_OPEN.some((r) => screen === r || screen.startsWith(r + '/'))) return null;
  return granted.some((r) => screen === r || screen.startsWith(r + '/')) ? null : screen;
}

/** Screens every sub-user may open (as the API's SubUserPermissions.AlwaysReadable). */
const ALWAYS_OPEN = ['/staff/dashboard', '/staff/home', '/staff/msme-profile', '/staff/change-password'];

export const subUserScreenGuard: CanActivateChildFn = (_route, state) => {
  const user = inject(AuthService).currentUser();
  if (!user?.permissionRoutes) return true;
  const blocked = blockedScreen(state.url, user.roleId, user.subRoles ?? [], user.permissionRoutes);
  return blocked ? inject(Router).createUrlTree(['/staff/no-access'], { queryParams: { screen: blocked } }) : true;
};

/** The clean refusal of a screen the sub-user was not given (no controls, no empty lists). */
@Component({
  selector: 'zed-staff-no-access',
  imports: [RouterLink, TextPipe],
  template: `
    <div class="zed-card na-card" role="alert">
      <h3 class="registration-title">{{ 'No access to this screen' | t: 'staff.noAccess.title' }}</h3>
      @if (byRole) {
        <!-- 2026-11-21 (audit item 11): a screen of another role (authGuard), not one the owner did not give. -->
        <p>{{ 'This screen is not available to your login.' | t: 'staff.noAccess.roleText' }}</p>
      } @else {
        <p>{{ 'This screen was not given to your login. Please ask your administrator if you need it.' | t: 'staff.noAccess.text' }}</p>
      }
      @if (screen) { <p class="muted na-screen">{{ screen }}</p> }
      <a routerLink="/staff" class="btn btn-primary">{{ 'Back to home' | t: 'staff.noAccess.home' }}</a>
    </div>
  `,
  styles: `
    .na-card { max-width: 560px; margin: 32px auto; padding: 24px; text-align: center; }
    .na-card p { margin: 8px 0 16px; }
    .na-screen { font-size: 12px; overflow-wrap: anywhere; }
  `,
})
export class NoAccessPage {
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly screen = this.query.get('screen');
  /** Sent by authGuard: the login's role may not open the screen (rather than a sub-user's screen not given). */
  protected readonly byRole = this.query.get('reason') === 'role';
}
