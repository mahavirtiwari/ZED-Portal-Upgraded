import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { Row, certificationKind, certificationLevel, milestoneNumber } from './certification.api';
import { PublicLevels } from '../shared/levels';

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
    .label-highlight { margin-bottom: 18px; }
    .label-highlight ul { margin: 6px 0 0; }
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

  /**
   * 2026-11-14: the level's steps follow its flow (Admin → Certification Levels): Remote only / Onsite only have no
   * desktop step; the site step is called Remote or Onsite Assessment by the flow ("Remote/Onsite" while unknown).
   */
  private readonly levels = inject(PublicLevels);
  private readonly flow = computed(() => {
    const code = certificationLevel(this.certification()).toLowerCase();
    return this.levels.levels()?.find((l) => l.code.toLowerCase() === code)?.assessmentFlow ?? null;
  });
  protected readonly hasDesktop = computed(() => this.flow() !== 'Remote' && this.flow() !== 'Onsite');
  protected readonly siteTitle = computed(() => {
    const f = this.flow();
    return f === 'Remote' || f === 'DesktopRemote' ? 'Remote Assessment' : f === 'Onsite' || f === 'DesktopOnsite' ? 'Onsite Assessment' : 'Remote/Onsite Assessment';
  });

  /** Description for a status type, or '' when ng-show would have hidden it (null, empty, 0, false). */
  protected s(field: string): string {
    const v = this.status()[field];
    return v === null || v === undefined || v === '' || v === 0 || v === false ? '' : String(v);
  }
}
