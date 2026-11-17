import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TimelineItem, splitDate } from './certification-progress';

/**
 * 2026-11-17 (the user's applicant design, zed-msme-01): the "Application timeline" card of a certification, newest first:
 * each entry's date, title and who acted (ZED / YOU); the non-conformance rounds grouped in one block, each with a View link
 * to the non-conformance page.
 */
@Component({
  selector: 'zed-certification-timeline',
  imports: [RouterLink],
  host: { class: 'd-block' },
  templateUrl: './certification-timeline.html',
  styleUrl: './certification-timeline.scss',
})
export class CertificationTimeline {
  readonly items = input.required<TimelineItem[]>();
  /** The non-conformance page (each round's View link); none: no link. */
  readonly ncRoute = input<string | null>(null);

  /** "5 May 2024" from a description, or the description itself. */
  protected when(text: string): string {
    return splitDate(text).date || text;
  }
}
