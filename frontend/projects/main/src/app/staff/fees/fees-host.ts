import { Component, inject } from '@angular/core';
import { AdminPortalService } from '../admin-portal';
import { AssessmentFeesPage } from './assessment-fees';
import { FeeStructurePage } from './fee-structure';

/**
 * Masters → Payments: the Fee Structure (main and surveillance) or the handholding fee per milestone (consultancy).
 * On the main portal the Admin's portal switch picks which (V4 one Admin); on the other builds, their own.
 */
@Component({
  selector: 'zed-staff-fees-host',
  imports: [AssessmentFeesPage, FeeStructurePage],
  template: `@if (consultancy) { <zed-staff-assessment-fees /> } @else { <zed-staff-fee-structure /> }`,
})
export class FeesHostPage {
  protected readonly consultancy = inject(AdminPortalService).effective() === 'consultancy';
}
