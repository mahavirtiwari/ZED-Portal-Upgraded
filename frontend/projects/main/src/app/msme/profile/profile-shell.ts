import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The sections of the applicant's profile: four on the profile page, two pages of their own. */
export type ProfileSection = 'enterprise' | 'contact' | 'units' | 'activity' | 'security' | 'history';

/** The sections shown on the profile page itself (the menu scrolls to them). */
export const PROFILE_PAGE_SECTIONS: readonly ProfileSection[] = ['enterprise', 'contact', 'units', 'activity'];

interface MenuItem {
  id: ProfileSection;
  label: string;
  note: string;
  /** A page of its own (Change password, Edit history). */
  link?: string;
}

/**
 * 2026-11-17 (the user's approved design "Enterprise profile"): the profile's left section menu, which replaces one long
 * scroll, with the page's content on its right. Used by the profile (`here`: the menu scrolls to its sections), Change
 * password ("Account & security") and Edit history, which keep their own routes. Below 992px the menu is a row of tabs
 * above the content.
 */
@Component({
  selector: 'zed-profile-shell',
  imports: [RouterLink],
  host: { class: 'd-block' },
  template: `
    <div class="ps">
      <nav class="ps-nav" aria-label="Profile sections">
        <ul>
          @for (i of items(); track i.id) {
            <li>
              @if (i.link) {
                <a [routerLink]="i.link" [class.on]="active() === i.id" [attr.aria-current]="active() === i.id ? 'page' : null">
                  <span>{{ i.label }}</span>@if (i.note) { <small>{{ i.note }}</small> }
                </a>
              } @else if (here()) {
                <button type="button" [class.on]="active() === i.id" [attr.aria-current]="active() === i.id ? 'true' : null" (click)="pick.emit(i.id)">
                  <span>{{ i.label }}</span>@if (i.note) { <small>{{ i.note }}</small> }
                </button>
              } @else {
                <a routerLink="/msme/profile" [fragment]="i.id"><span>{{ i.label }}</span>@if (i.note) { <small>{{ i.note }}</small> }</a>
              }
            </li>
          }
        </ul>
      </nav>
      <div class="ps-main"><ng-content /></div>
    </div>
  `,
  styles: `
    .ps { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 20px; align-items: start; }
    .ps-nav { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 10px 8px; box-shadow: 0 2px 8px rgba(23, 63, 68, .05); position: sticky; top: 12px; }
    .ps-nav ul { list-style: none; margin: 0; padding: 0; }
    .ps-nav a, .ps-nav button { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%; padding: 11px 14px 11px 18px;
      border: 0; border-left: 3px solid transparent; border-radius: 8px; background: none; color: var(--zt-ink, #173f44); font-size: 14.5px;
      font-weight: 500; text-align: left; text-decoration: none; }
    .ps-nav a:hover, .ps-nav button:hover { background: #f1f7f6; }
    .ps-nav .on { background: var(--zt-soft, #d4ebe6); border-left-color: var(--zt-dark, #1f5c61); color: var(--zt-dark, #1f5c61); font-weight: 700; }
    .ps-nav small { color: #6b7b7c; font-size: 12px; font-weight: 400; white-space: nowrap; }
    .ps-main { min-width: 0; display: flex; flex-direction: column; gap: 20px; }
    @media (max-width: 991.98px) {
      .ps { grid-template-columns: minmax(0, 1fr); gap: 14px; }
      .ps-nav { position: static; padding: 6px; }
      .ps-nav ul { display: flex; gap: 4px; overflow-x: auto; }
      .ps-nav li { flex: none; }
      .ps-nav a, .ps-nav button { padding: 8px 12px; border-left: 0; border-bottom: 3px solid transparent; white-space: nowrap; }
      .ps-nav .on { border-bottom-color: var(--zt-dark, #1f5c61); }
      .ps-nav small { display: none; }
    }
  `,
})
export class ProfileShell {
  /** The section shown (highlighted in the menu). */
  readonly active = input<ProfileSection>('enterprise');
  /** On the profile page: the menu's first four entries are buttons that emit `pick`; elsewhere links to the profile. */
  readonly here = input(false);
  /** The number of units (plants), when known. */
  readonly units = input<number | null>(null);
  /** The number of recorded changes, when known. */
  readonly changes = input<number | null>(null);
  readonly pick = output<ProfileSection>();

  protected readonly items = computed<MenuItem[]>(() => {
    const u = this.units();
    const c = this.changes();
    return [
      { id: 'enterprise', label: 'Enterprise', note: 'From Udyam' },
      { id: 'contact', label: 'Contact', note: 'E-mail & mobile' },
      { id: 'units', label: 'Units / plants', note: u ? `${u} unit${u === 1 ? '' : 's'}` : '' },
      { id: 'activity', label: 'Unit activity (NIC)', note: '' },
      { id: 'security', label: 'Account & security', note: 'Password', link: '/msme/change-password' },
      { id: 'history', label: 'Edit history', note: c === null ? '' : `${c} change${c === 1 ? '' : 's'}`, link: '/msme/edit-history' },
    ];
  });
}
