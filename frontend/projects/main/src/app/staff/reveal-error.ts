/** What counts as an error on a staff form: a field marked invalid, its message, or an error alert. */
export const ERROR_SELECTOR = '.is-invalid, [aria-invalid="true"], .invalid-feedback.d-block, .alert-danger';

/**
 * 2026-11-21 (UI audit F2/F4/F5): after the page has drawn the errors, scrolls the first one into view (inside a pop-up's
 * scrolling body too) and puts the cursor in it when it is a field, so an error at the top of a long form or under a
 * pop-up's footer is never missed.
 */
export function revealError(root: ParentNode | null = null, selector = ERROR_SELECTOR): void {
  setTimeout(() => {
    const first = (root ?? document).querySelector<HTMLElement>(selector);
    if (!first) return;
    first.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    if (first.matches('input, select, textarea')) first.focus({ preventScroll: true });
  });
}
