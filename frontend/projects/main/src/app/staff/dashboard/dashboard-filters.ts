import { computed, signal } from '@angular/core';
import { Row } from './dashboard.api';

export interface Option {
  value: string;
  label: string;
}

/** State drop-down of the list pages (value = LGD state code, Msme.StateId). */
export const STATES: Option[] = [
  ['35', 'ANDAMAN AND NICOBAR ISLANDS'], ['28', 'ANDHRA PRADESH'], ['12', 'ARUNACHAL PRADESH'], ['18', 'ASSAM'], ['10', 'BIHAR'],
  ['4', 'CHANDIGARH'], ['22', 'CHHATTISGARH'], ['7', 'DELHI'], ['30', 'GOA'], ['24', 'GUJARAT'], ['6', 'HARYANA'],
  ['2', 'HIMACHAL PRADESH'], ['1', 'JAMMU AND KASHMIR'], ['20', 'JHARKHAND'], ['29', 'KARNATAKA'], ['32', 'KERALA'], ['37', 'LADAKH'],
  ['31', 'LAKSHADWEEP'], ['23', 'MADHYA PRADESH'], ['27', 'MAHARASHTRA'], ['14', 'MANIPUR'], ['17', 'MEGHALAYA'], ['15', 'MIZORAM'],
  ['13', 'NAGALAND'], ['21', 'ODISHA'], ['34', 'PUDUCHERRY'], ['3', 'PUNJAB'], ['8', 'RAJASTHAN'], ['11', 'SIKKIM'],
  ['33', 'TAMIL NADU'], ['36', 'TELANGANA'], ['38', 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU'], ['16', 'TRIPURA'],
  ['9', 'UTTAR PRADESH'], ['5', 'UTTARAKHAND'], ['19', 'WEST BENGAL'],
].map(([value, label]) => ({ value, label }));

/** State drop-down of the home dashboard (value = Msme.PStateName). */
export const STATE_NAMES: string[] = [
  'ANDAMAN AND NICOBAR ISLANDS', 'ANDHRA PRADESH', 'ARUNACHAL PRADESH', 'ASSAM', 'BIHAR', 'CHANDIGARH', 'CHHATTISGARH',
  'DADAR AND NAGAR HAVELI', 'DAMAN AND DIU', 'DELHI', 'GOA', 'GUJARAT', 'HARYANA', 'HIMACHAL PRADESH', 'JAMMU AND KASHMIR',
  'JHARKHAND', 'KARNATAKA', 'KERALA', 'LADAKH', 'MADHYA PRADESH', 'MAHARASHTRA', 'MANIPUR', 'MEGHALAYA', 'MIZORAM', 'NAGALAND',
  'ODISHA', 'PUDUCHERRY', 'PUNJAB', 'RAJASTHAN', 'SIKKIM', 'TAMIL NADU', 'TELANGANA', 'TRIPURA', 'UTTAR PRADESH', 'UTTARAKHAND',
  'WEST BENGAL',
];

export const CERTIFICATIONS = ['Bronze', 'Silver', 'Gold'];
export const SIZES = ['Micro', 'Small', 'Medium'];
export const GENDERS: Option[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'Others', label: 'Others' },
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
