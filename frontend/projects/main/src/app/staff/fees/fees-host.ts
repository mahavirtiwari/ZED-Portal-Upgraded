import { Component } from '@angular/core';
import { FeeStructurePage } from './fee-structure';

/**
 * Masters → Payments: the Fee Structure of the portal the Admin's switch picks (V4 one Admin), the same page on all three:
 * per level on ZED Certification and Surveillance, per handholding milestone on Consultancy.
 */
@Component({
  selector: 'zed-staff-fees-host',
  imports: [FeeStructurePage],
  template: `<zed-staff-fee-structure />`,
})
export class FeesHostPage {}
