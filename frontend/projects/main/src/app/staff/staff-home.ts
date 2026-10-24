import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService, ClientConfigService } from '@zed/shared';
import { StaffMenuItem, menuEntries, menuFor } from './staff-menu';

/** A group with more screens than this is a chooser (e.g. the incentives of every state), not a list. */
const LIST_LIMIT = 8;

/**
 * Landing page after staff sign-in: the screens this role can use. Single screens are tiles; a menu group (e.g.
 * Questionnaire, Settings) is one card with its screens, and a long group (the incentives per state) a chooser.
 */
@Component({
  selector: 'zed-staff-home',
  imports: [RouterLink],
  template: `
    <div class="home py-3">
      <div class="d-flex flex-wrap align-items-baseline gap-2 mb-3">
        <h3 class="registration-title dash-text-clr mb-0">Welcome, {{ user()?.actingUserName || user()?.userName }}</h3>
        <span class="role-badge">{{ user()?.role }}{{ subRoleText() }}</span>
      </div>

      @if (singles().length) {
        <div class="row g-3 mb-2">
          @for (item of singles(); track item.label + (item.route ?? item.legacyPath)) {
            <div class="col-6 col-md-4 col-xl-3">
              @if (item.route) {
                <a class="tile" [routerLink]="item.route" [queryParams]="item.queryParams">
                  <span>{{ item.label }}</span><span class="arrow" aria-hidden="true">›</span>
                </a>
              } @else {
                <a class="tile" [href]="legacyUrl() + item.legacyPath" title="Opens the current portal">
                  <span>{{ item.label }}</span><span class="arrow" aria-hidden="true">↗</span>
                </a>
              }
            </div>
          }
        </div>
      }

      @if (groups().length) {
        <div class="row g-3">
          @for (g of groups(); track g.group) {
            <div class="col-md-6 col-xl-4">
              <section class="group-card h-100">
                <h4>{{ g.group }}</h4>
                @if (g.items.length > listLimit) {
                  <label class="form-label small text-muted" [for]="'choose-' + $index">Choose one of {{ g.items.length }}</label>
                  <select class="form-select" [id]="'choose-' + $index" (change)="open(g.items, $any($event.target).value)">
                    <option value="">-- Select --</option>
                    @for (item of g.items; track $index) { <option [value]="$index">{{ item.label }}</option> }
                  </select>
                } @else {
                  <ul class="list-unstyled mb-0">
                    @for (item of g.items; track item.label + (item.route ?? item.legacyPath)) {
                      <li>
                        @if (item.route) {
                          <a [routerLink]="item.route" [queryParams]="item.queryParams">{{ item.label }}</a>
                        } @else {
                          <a [href]="legacyUrl() + item.legacyPath" title="Opens the current portal">{{ item.label }} ↗</a>
                        }
                      </li>
                    }
                  </ul>
                }
              </section>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .role-badge { background: #e8f4f5; color: #2f7c83; border-radius: 12px; padding: 2px 12px; font-size: 13px; font-weight: 600; }
    .tile {
      display: flex; justify-content: space-between; align-items: center; height: 100%; min-height: 64px;
      padding: 14px 16px; border-radius: 12px; background: #fff; border: 1px solid #dfe9ea;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05); color: #232527; font-weight: 600; text-decoration: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .tile:hover, .tile:focus { border-color: #45a5ad; box-shadow: 0 4px 12px rgba(69, 165, 173, 0.2); color: #232527; }
    .tile .arrow { color: #45a5ad; font-size: 22px; line-height: 1; margin-left: 8px; }
    .group-card { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 16px 18px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05); }
    .group-card h4 { font-size: 16px; font-weight: 700; color: #2f7c83; margin-bottom: 10px; }
    .group-card li + li { border-top: 1px solid #eef3f3; }
    .group-card li a { display: block; padding: 7px 0; color: #232527; font-weight: 500; text-decoration: none; }
    .group-card li a:hover, .group-card li a:focus { color: #45a5ad; }
  `,
})
export class StaffHomePage {
  private readonly router = inject(Router);
  protected readonly user = inject(AuthService).currentUser;
  protected readonly legacyUrl = signal('');
  protected readonly listLimit = LIST_LIMIT;
  private readonly entries = computed(() => {
    const u = this.user();
    return menuEntries(u ? menuFor(u.roleId, u.subRoles ?? [], undefined, u.permissionRoutes) : []);
  });
  protected readonly singles = computed(() => this.entries().flatMap((e) => ('item' in e ? [e.item] : [])));
  protected readonly groups = computed(() => this.entries().flatMap((e) => ('group' in e ? [e] : [])));
  protected readonly subRoleText = computed(() => {
    const subs = this.user()?.subRoles ?? [];
    return subs.length && subs.length < 3 ? ' · ' + subs.map((s) => s.replace('Verification', ' Verification')).join(', ') : '';
  });

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
  }

  /** The chooser of a long group: opens the screen picked. */
  protected open(items: readonly StaffMenuItem[], index: string): void {
    const item = items[Number(index)];
    if (!item || index === '') return;
    if (item.route) void this.router.navigate([item.route], { queryParams: item.queryParams });
    else window.location.href = this.legacyUrl() + (item.legacyPath ?? '');
  }
}
