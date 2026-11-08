import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * "Watch video" next to a requirement (2026-11-08): the video the Admin gave it in Questionnaire → Requirements, on the
 * MSME's pages and on the assessment and review pages. Nothing when the requirement has none; only http(s) addresses.
 */
@Component({
  selector: 'zed-requirement-video',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (href(); as url) {
      <a class="req-video" [href]="url" target="_blank" rel="noopener noreferrer" [attr.title]="'Watch the video on requirement ' + (code() ?? '')"
         [class.compact]="compact()">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
        @if (!compact()) { <span>Watch video</span> } @else { <span class="visually-hidden">Watch video</span> }
      </a>
    }
  `,
  styles: [
    `
      .req-video { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; line-height: 1;
        padding: 4px 10px; border-radius: 999px; background: #e3f2f3; color: #1d6a70; text-decoration: none; white-space: nowrap;
        vertical-align: middle; margin-left: 6px; }
      .req-video:hover, .req-video:focus-visible { background: #c9e7e9; color: #134b50; }
      .req-video.compact { padding: 4px 6px; margin: 4px 0 0; }
      .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    `,
  ],
})
export class RequirementVideo {
  readonly url = input<unknown>(null);
  readonly code = input<string | null>(null);
  /** Only the play sign (the narrow requirement-number cells of the review tables). */
  readonly compact = input(false);

  protected readonly href = computed(() => {
    const u = typeof this.url() === 'string' ? (this.url() as string).trim() : '';
    return /^https?:\/\//i.test(u) ? u : null;
  });
}
