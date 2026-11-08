import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** A state of the LG Directory masters (LGD code, as Msme.StateId). */
export interface StateInfo {
  code: string;
  name: string;
}

/** The states as of 2026, until api/public/states answers (or when it cannot). */
export const BUILT_IN_STATES: readonly StateInfo[] = (
  [
    ['35', 'ANDAMAN AND NICOBAR ISLANDS'], ['28', 'ANDHRA PRADESH'], ['12', 'ARUNACHAL PRADESH'], ['18', 'ASSAM'], ['10', 'BIHAR'],
    ['4', 'CHANDIGARH'], ['22', 'CHHATTISGARH'], ['7', 'DELHI'], ['30', 'GOA'], ['24', 'GUJARAT'], ['6', 'HARYANA'],
    ['2', 'HIMACHAL PRADESH'], ['1', 'JAMMU AND KASHMIR'], ['20', 'JHARKHAND'], ['29', 'KARNATAKA'], ['32', 'KERALA'], ['37', 'LADAKH'],
    ['31', 'LAKSHADWEEP'], ['23', 'MADHYA PRADESH'], ['27', 'MAHARASHTRA'], ['14', 'MANIPUR'], ['17', 'MEGHALAYA'], ['15', 'MIZORAM'],
    ['13', 'NAGALAND'], ['21', 'ODISHA'], ['34', 'PUDUCHERRY'], ['3', 'PUNJAB'], ['8', 'RAJASTHAN'], ['11', 'SIKKIM'],
    ['33', 'TAMIL NADU'], ['36', 'TELANGANA'], ['38', 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU'], ['16', 'TRIPURA'],
    ['9', 'UTTAR PRADESH'], ['5', 'UTTARAKHAND'], ['19', 'WEST BENGAL'],
  ] as const
).map(([code, name]) => ({ code, name }));

let current: readonly StateInfo[] = BUILT_IN_STATES;
const listeners: ((states: readonly StateInfo[]) => void)[] = [];

/**
 * Keeps a page's state list in step with the masters (2026-11-08: the LG Directory, before fixed copies): calls
 * <paramref name="apply"/> now with the states known so far and again when api/public/states has answered.
 */
export function onStates(apply: (states: readonly StateInfo[]) => void): void {
  apply(current);
  listeners.push(apply);
}

/** The states known now. */
export function states(): readonly StateInfo[] {
  return current;
}

/** Test support and the loader: use these states (ignored when empty). */
export function setStates(list: readonly StateInfo[]): void {
  if (!list.length) return;
  current = [...list].sort((a, b) => a.name.localeCompare(b.name));
  for (const apply of listeners) apply(current);
}

/** Loads api/public/states once, when the app starts (the page waits at most 3 seconds for it). */
@Injectable({ providedIn: 'root' })
export class PublicStates {
  private readonly http = inject(HttpClient);
  private loading: Promise<void> | null = null;

  load(waitMs = 3000): Promise<void> {
    this.loading ??= firstValueFrom(this.http.get<StateInfo[]>('/api/public/states'))
      .then((list) => setStates((list ?? []).filter((s) => !!s?.code && !!s?.name)))
      .catch(() => {
        this.loading = null;
      });
    return Promise.race([this.loading, new Promise<void>((resolve) => setTimeout(resolve, waitMs))]);
  }
}
