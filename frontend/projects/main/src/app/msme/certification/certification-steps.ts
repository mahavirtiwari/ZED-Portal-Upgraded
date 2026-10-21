import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { Row, certificationKind, milestoneNumber } from './certification.api';

/**
 * The "Status" timeline of Views/Msme/CertificationDetails.cshtml (also used by ViewStatus.cshtml):
 * the "Application Received" box and the numbered steps, filled from the MsmeHistory descriptions.
 * Steps stay in the DOM while hidden (as ng-show did) so the step colours, which use :nth-child,
 * match the old page.
 */
@Component({
  selector: 'zed-certification-steps',
  imports: [NgTemplateOutlet],
  templateUrl: './certification-steps.html',
  styles: `
    .list-tick:before { content: '✓ '; }
    .list-tick { list-style: none !important; }
  `,
})
export class CertificationSteps {
  readonly certification = input.required<string>();
  readonly status = input.required<Row>();
  /** Link for "Avail Incentives". */
  readonly incentiveUrl = input('');

  protected readonly kind = computed(() => certificationKind(this.certification()));
  protected readonly milestone = computed(() => milestoneNumber(this.certification()));

  protected readonly ncRounds = [1, 2, 3, 4, 5];

  /** Description for a status type, or '' when ng-show would have hidden it (null, empty, 0, false). */
  protected s(field: string): string {
    const v = this.status()[field];
    return v === null || v === undefined || v === '' || v === 0 || v === false ? '' : String(v);
  }
}
