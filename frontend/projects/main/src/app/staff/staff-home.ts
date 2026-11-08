import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService, ClientConfigService } from '@zed/shared';
import { StaffMenuItem, StaffMenuSection, menuEntries, menuFor, staffRoleName } from './staff-menu';

/** A heading with more screens than this is a chooser (e.g. the incentives of every state), not a list. */
const LIST_LIMIT = 8;

/** Line icons (24x24, stroke) for the tiles and cards, picked by words of the label. */
const ICONS: [RegExp, string][] = [
  [/document/i, 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6'],
  [/image|upload image/i, 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01'],
  [/upload/i, 'M12 16V4M7 9l5-5 5 5M5 20h14'],
  [/sector|master/i, 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  [/payment|fee|neft|transaction/i, 'M3 6h18v12H3zM3 10h18M7 15h4'],
  [/user|admin|login|assessor|consultant|agenc|organisation/i, 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0'],
  [/setting/i, 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4z'],
  [/questionnaire|parameter|requirement/i, 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2'],
  [/technolog/i, 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4'],
  [/incentive|scheme|financial/i, 'M4 10h16v10H4zM2 7h20v3H2zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0'],
  [/report|dashboard|registered|support/i, 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  [/history/i, 'M12 7v5l3 3M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5'],
  [/monitor/i, 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  [/allot/i, 'M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7'],
  [/complet|certif|milestone/i, 'M20 6 9 17l-5-5'],
  [/reject|non-conform/i, 'M12 3 2 21h20zM12 10v4M12 17h.01'],
];
const DEFAULT_ICON = 'M9 6l6 6-6 6';

export function iconFor(label: string): string {
  return ICONS.find(([re]) => re.test(label))?.[1] ?? DEFAULT_ICON;
}

/**
 * Landing page after staff sign-in: the screens this role can use. Single screens are tiles; each menu (e.g. Masters,
 * Administration) is a card with its headings, and a long heading (the incentives per state) a chooser.
 */
@Component({
  selector: 'zed-staff-home',
  imports: [RouterLink],
  template: `
    <div class="home">
      <div class="welcome">
        <div>
          <h3 class="mb-1">Welcome, {{ user()?.actingUserName || user()?.userName }}</h3>
          <p class="mb-0 text-muted">Choose a screen to start. The same screens are in the menu above.</p>
        </div>
        <span class="role-badge">{{ roleName() }}{{ subRoleText() }}</span>
      </div>

      @if (singles().length) {
        <div class="row g-3 mb-3">
          @for (item of singles(); track item.label + (item.route ?? item.legacyPath)) {
            <div class="col-sm-6 col-lg-4 col-xl-3">
              @if (item.route) {
                <a class="tile" [routerLink]="item.route" [queryParams]="item.queryParams">
                  <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path [attr.d]="icon(item.label)" /></svg></span>
                  <span class="label">{{ item.label }}</span>
                  <span class="arrow" aria-hidden="true">›</span>
                </a>
              } @else {
                <a class="tile" [href]="legacyUrl() + item.legacyPath" title="Opens the current portal">
                  <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path [attr.d]="icon(item.label)" /></svg></span>
                  <span class="label">{{ item.label }}</span>
                  <span class="arrow" aria-hidden="true">↗</span>
                </a>
              }
            </div>
          }
        </div>
      }

      <div class="row g-3">
        @for (g of groups(); track g.group) {
          <div class="col-md-6 col-xl-4">
            <section class="group-card h-100" [attr.aria-label]="g.group">
              <h4>
                <span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path [attr.d]="icon(g.group)" /></svg></span>
                {{ g.group }}
              </h4>
              @for (section of g.sections; track $index) {
                @if (section.heading) { <h5>{{ section.heading }}</h5> }
                @if (section.items.length > listLimit) {
                  <label class="chooser-label" [for]="chooserId(g.group, $index)">Choose one of {{ section.items.length }}</label>
                  <select class="form-select" [id]="chooserId(g.group, $index)" (change)="open(section, $any($event.target).value)">
                    <option value="">-- Select --</option>
                    @for (item of section.items; track $index) { <option [value]="$index">{{ item.label }}</option> }
                  </select>
                } @else {
                  <ul class="list-unstyled mb-2">
                    @for (item of section.items; track item.label + (item.route ?? item.legacyPath)) {
                      <li>
                        @if (item.route) {
                          <a [routerLink]="item.route" [queryParams]="item.queryParams">{{ item.label }}<span aria-hidden="true">›</span></a>
                        } @else {
                          <a [href]="legacyUrl() + item.legacyPath" title="Opens the current portal">{{ item.label }}<span aria-hidden="true">↗</span></a>
                        }
                      </li>
                    }
                  </ul>
                }
              }
            </section>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .welcome {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; padding: 18px 22px; margin-bottom: 18px;
      box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06);
    }
    .welcome h3 { font-size: 22px; font-weight: 700; color: #23474a; }
    .role-badge { background: #e8f4f5; color: #2f7c83; border-radius: 14px; padding: 4px 14px; font-size: 13px; font-weight: 700; }
    .icon { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 10px; background: #e8f4f5; flex: 0 0 auto; }
    .icon svg { width: 20px; height: 20px; fill: none; stroke: #2f7c83; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .tile {
      display: flex; align-items: center; gap: 12px; height: 100%; min-height: 70px; padding: 14px 16px; border-radius: 14px;
      background: #fff; border: 1px solid #dfe9ea; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06);
      color: #232527; font-weight: 600; text-decoration: none; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
    }
    .tile .label { flex: 1 1 auto; }
    .tile .arrow { color: #45a5ad; font-size: 22px; line-height: 1; }
    .tile:hover, .tile:focus { border-color: #45a5ad; box-shadow: 0 6px 16px rgba(69, 165, 173, 0.18); transform: translateY(-1px); color: #232527; }
    .group-card { background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; padding: 16px 18px 10px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); }
    .group-card h4 { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: #23474a; margin-bottom: 8px; }
    .group-card h5 { font-size: 12px; font-weight: 700; color: #45a5ad; text-transform: uppercase; letter-spacing: 0.4px; margin: 12px 0 2px; }
    .group-card li + li { border-top: 1px solid #eef3f3; }
    .group-card li a { display: flex; justify-content: space-between; padding: 8px 2px; color: #232527; font-weight: 500; text-decoration: none; }
    .group-card li a span { color: #9bbfc2; }
    .group-card li a:hover, .group-card li a:focus { color: #2f7c83; }
    .group-card li a:hover span { color: #45a5ad; }
    .chooser-label { display: block; background: none; padding: 0; font-size: 13px; color: #5f6f70; margin: 4px 0 6px; }
    .group-card .form-select { margin-bottom: 10px; }
  `,
})
export class StaffHomePage {
  private readonly router = inject(Router);
  protected readonly user = inject(AuthService).currentUser;
  protected readonly legacyUrl = signal('');
  protected readonly listLimit = LIST_LIMIT;
  protected readonly icon = iconFor;
  private readonly entries = computed(() => {
    const u = this.user();
    return menuEntries(u ? menuFor(u.roleId, u.subRoles ?? [], undefined, u.permissionRoutes) : []);
  });
  protected readonly singles = computed(() => this.entries().flatMap((e) => ('item' in e ? [e.item] : [])));
  protected readonly groups = computed(() => this.entries().flatMap((e) => ('group' in e ? [e] : [])));
  protected readonly roleName = computed(() => staffRoleName(this.user()));
  protected readonly subRoleText = computed(() => {
    const subs = this.user()?.subRoles ?? [];
    return subs.length && subs.length < 3 ? ' · ' + subs.map((s) => s.replace('Verification', ' Verification')).join(', ') : '';
  });

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
  }

  protected chooserId(group: string, index: number): string {
    return 'choose-' + group.replace(/\W+/g, '-').toLowerCase() + '-' + index;
  }

  /** The chooser of a long heading: opens the screen picked. */
  protected open(section: StaffMenuSection, index: string): void {
    const item: StaffMenuItem | undefined = section.items[Number(index)];
    if (!item || index === '') return;
    if (item.route) void this.router.navigate([item.route], { queryParams: item.queryParams });
    else window.location.href = this.legacyUrl() + (item.legacyPath ?? '');
  }
}
