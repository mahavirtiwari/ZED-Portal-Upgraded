import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, ClientConfigService } from '@zed/shared';
import { menuFor } from './staff-menu';

/** Landing page after staff sign-in: the screens this role can use, as cards. */
@Component({
  selector: 'zed-staff-home',
  imports: [RouterLink],
  template: `
    <div class="container py-4">
      <h3 class="registration-title dash-text-clr">Welcome, {{ user()?.userName }}</h3>
      <p class="text-muted">Signed in as {{ user()?.role }}{{ subRoleText() }}.</p>
      <div class="row g-3 mt-2">
        @for (item of menu(); track item.label + (item.route ?? item.legacyPath)) {
          <div class="col-sm-6 col-lg-4">
            <div class="panel panel-default h-100">
              <div class="panel-body d-flex justify-content-between align-items-center">
                <strong>{{ item.label }}</strong>
                @if (item.route) {
                  <a class="btn btn-primary btn-sm" [routerLink]="item.route">Open</a>
                } @else {
                  <a class="btn btn-default btn-sm" [href]="legacyUrl() + item.legacyPath" title="Opens the current portal">Open (current portal)</a>
                }
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class StaffHomePage {
  protected readonly user = inject(AuthService).currentUser;
  protected readonly legacyUrl = signal('');
  protected readonly menu = computed(() => {
    const u = this.user();
    return u ? menuFor(u.roleId, u.subRoles ?? [], undefined, u.permissionRoutes) : [];
  });
  protected readonly subRoleText = computed(() => {
    const subs = this.user()?.subRoles ?? [];
    return subs.length && subs.length < 3 ? ' (' + subs.map((s) => s.replace('Verification', ' Verification')).join(', ') + ')' : '';
  });

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
  }
}
