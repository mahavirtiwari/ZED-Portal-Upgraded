import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { IncentiveSchemePage } from './incentive-scheme';

/**
 * 2026-11-27 (UI review: from /msme/incentive-schemes/TU_DIRECT to /msme/incentive-schemes/FA without a reload, the FA page kept
 * the Technology Upgradation scheme): the router reuses the page when only the scheme code changes, and the page reads its scheme
 * once. A fresh page is made for each code (its steps, answers and bank details start over, as on a reload).
 */
@Component({
  selector: 'zed-msme-incentive-scheme-host',
  imports: [IncentiveSchemePage],
  template: `@for (c of [code()]; track c) { <zed-msme-incentive-scheme /> }`,
})
export class IncentiveSchemeHost {
  protected readonly code = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('code') ?? '')), { requireSync: true });
}
