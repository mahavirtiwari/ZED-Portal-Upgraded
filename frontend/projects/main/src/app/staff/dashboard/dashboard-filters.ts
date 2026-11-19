import { computed, signal } from '@angular/core';
import { Row } from './dashboard.api';
import { onStates } from '../../msme/shared/states';
import { t } from '../../content/page-text';

export interface Option {
  value: string;
  label: string;
}

/** State drop-down of the list pages (value = LGD state code, Msme.StateId): the LG Directory masters (2026-11-08). */
export const STATES: Option[] = [];
/** Names units registered before the 2020 merger still carry (Msme.PStateName). */
const FORMER_NAMES = ['DADAR AND NAGAR HAVELI', 'DAMAN AND DIU'];
/** State drop-down of the home dashboard (value = Msme.PStateName): the masters' names and the two former names. */
export const STATE_NAMES: string[] = [];
onStates((list) => {
  STATES.splice(0, STATES.length, ...list.map((s) => ({ value: s.code, label: s.name })));
  STATE_NAMES.splice(0, STATE_NAMES.length, ...[...list.map((s) => s.name), ...FORMER_NAMES].sort());
});

/** The legacy levels (the surveillance analytics' columns). The list pages' filters offer every level: levelOptions(). */
export const CERTIFICATIONS = ['Bronze', 'Silver', 'Gold'];
export const SIZES = ['Micro', 'Small', 'Medium'];
export const GENDERS: Option[] = [
  { value: 'male', get label() { return t('staff.listFilters.gender.male', 'Male'); } },
  { value: 'female', get label() { return t('staff.listFilters.gender.female', 'Female'); } },
  { value: 'Others', get label() { return t('staff.listFilters.gender.others', 'Others'); } },
];

export function text(row: Row, field: string): string {
  const v = row[field];
  return v === null || v === undefined ? '' : String(v);
}

/** Truthy like the AngularJS ng-show expressions (0, '0', '', null are false). */
export function flag(row: Row, field: string): boolean {
  const v = row[field];
  return !!v && v !== '0' && v !== 'false';
}

export { ClientPager } from '../pager';
