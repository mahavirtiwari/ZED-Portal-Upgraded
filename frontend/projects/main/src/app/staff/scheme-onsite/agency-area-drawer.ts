import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { SideDrawer } from '../side-drawer';
import { OnsiteAgencyRow, SchemeOnsiteApi } from './scheme-onsite.api';

/**
 * 2026-11-26 (the user, Incentive Verification Agencies: "This is not looking good. please suggest alternative"; chosen: a summary
 * in the list and a side panel): an agency's states and their districts (by name, read from the LGD list of each state that is not
 * served whole), with a search box, in the History-style side panel. Read-only; "Edit area" opens the agency's page.
 */
@Component({
  selector: 'zed-agency-area-drawer',
  imports: [SideDrawer, TextPipe, RouterLink],
  template: `
    <zed-side-drawer id="agency-area-drawer" [title]="'States and districts' | t: 'staff.incentiveAgencies.area.title'"
                     [subtitle]="agency().userName + ' · ' + agency().userId" (closed)="closed.emit()">
      <p class="ad-sum" data-area-summary>{{ summary() }}</p>
      @if (agency().states.length > 6) {
        <input type="search" class="form-control ad-q" maxlength="40" [placeholder]="'Search a state or district' | t: 'staff.incentiveAgencies.area.search'"
               [attr.aria-label]="'Search a state or district' | t: 'staff.incentiveAgencies.area.search'" [value]="q()" (input)="q.set($any($event.target).value)" />
      }
      <ul class="ad-list" data-area-list>
        @for (a of shown(); track a.state) {
          <li>
            <div class="ad-top"><b>{{ a.state }}</b>
              <span class="ad-tag" [class.ad-whole]="!a.districts.length">{{ a.districts.length ? ('{n} district(s)' | t: 'staff.schemeOnsite.row.districts' : { n: a.districts.length }) : ('Whole state' | t: 'staff.incentiveAgencies.area.wholeState') }}</span>
            </div>
            @if (a.districts.length) {
              <div class="ad-districts">@for (d of a.names; track $index) { <span>{{ d }}</span> }</div>
            }
          </li>
        } @empty {
          <li class="ad-none">{{ 'No state or district matches the search.' | t: 'staff.incentiveAgencies.area.none' }}</li>
        }
      </ul>
      <div drawer-foot class="ad-foot">
        <a class="btn btn-outline-primary" [routerLink]="['/staff/scheme-agencies', agency().userId]">{{ 'Edit area' | t: 'staff.incentiveAgencies.area.edit' }}</a>
        <button type="button" class="btn btn-default" (click)="closed.emit()">{{ 'Close' | t: 'staff.incentiveAgencies.area.close' }}</button>
      </div>
    </zed-side-drawer>
  `,
  styles: `
    .ad-sum { margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #24666b; }
    .ad-q { height: 38px; margin-bottom: 12px; font-size: 13px; }
    .ad-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .ad-list li { padding: 10px 12px; border: 1px solid #dde7e8; border-radius: 10px; }
    .ad-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .ad-top b { font-size: 13.5px; color: #17373b; overflow-wrap: anywhere; }
    .ad-tag { flex: none; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px; background: #fdf1de; color: #8a5a00; }
    .ad-tag.ad-whole { background: #e6f2f3; color: #24666b; }
    .ad-districts { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 8px; }
    .ad-districts span { font-size: 12px; padding: 1px 8px; border-radius: 10px; background: #f3f7f7; color: #3d5559; }
    .ad-none { color: #6f8487; font-size: 12.5px; text-align: center; }
    .ad-foot { display: contents; }
  `,
})
export class AgencyAreaDrawer {
  private readonly api = inject(SchemeOnsiteApi);
  readonly agency = input.required<OnsiteAgencyRow>();
  /** Every state of the master list (0 when not known): "all states" when the agency serves each of them whole. */
  readonly totalStates = input(0);
  readonly closed = output<void>();
  protected readonly q = signal('');
  /** District names by state (LGD code → name), read once per state. */
  private readonly names = signal<Record<string, Record<string, string>>>({});

  constructor() {
    effect(() => {
      const states = this.agency().states.filter((a) => a.districts.length).map((a) => a.state);
      untracked(() => void this.loadNames(states));
    });
  }

  protected readonly summary = computed(() => areaSummary(this.agency(), this.totalStates()));

  protected readonly shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    const names = this.names();
    return this.agency().states
      .map((a) => ({ ...a, names: a.districts.map((d) => names[a.state]?.[d] ?? d) }))
      .filter((a) => !q || a.state.toLowerCase().includes(q) || a.names.some((n) => n.toLowerCase().includes(q)));
  });

  private async loadNames(states: string[]): Promise<void> {
    for (const s of states) {
      if (this.names()[s]) continue;
      try {
        const list = await firstValueFrom(this.api.districts(s));
        this.names.update((m) => ({ ...m, [s]: Object.fromEntries(list.map((d) => [d.code, d.name])) }));
      } catch {
        // The codes stay shown.
      }
    }
  }
}

/** "All 36 states · whole", "3 states · 7 districts", "1 state · whole" (the list's cell and the panel's first line). */
export function areaSummary(r: OnsiteAgencyRow, totalStates: number): string {
  const n = r.states.length;
  const districts = r.states.reduce((sum, a) => sum + a.districts.length, 0);
  const whole = r.states.filter((a) => !a.districts.length).length;
  if (totalStates > 0 && n >= totalStates && districts === 0) return t('staff.incentiveAgencies.area.all', 'All {n} states · whole', { n });
  const states = n === 1 ? t('staff.incentiveAgencies.area.oneState', '1 state') : t('staff.incentiveAgencies.area.states', '{n} states', { n });
  if (districts === 0) return t('staff.incentiveAgencies.area.statesWhole', '{states} · whole', { states });
  const d = districts === 1 ? t('staff.incentiveAgencies.area.oneDistrict', '1 district') : t('staff.incentiveAgencies.area.districts', '{n} districts', { n: districts });
  return whole
    ? t('staff.incentiveAgencies.area.mixed', '{states} · {districts} · {whole} whole', { states, districts: d, whole })
    : t('staff.incentiveAgencies.area.statesDistricts', '{states} · {districts}', { states, districts: d });
}
