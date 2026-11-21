import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { t } from '../content/page-text';
import { ConfirmService } from './confirm-dialog';

/** A page that knows whether it has changes not saved yet. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * 2026-11-21 (Assessment Agency UI audit, item 5): leaving a form with changes not saved asks first (Leave / Stay). The page
 * says whether it has such changes; Stay (or Esc) keeps the user on the page.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (page) =>
  !page?.hasUnsavedChanges?.() ||
  inject(ConfirmService).ask({
    title: t('staff.unsaved.title', 'Leave without saving?'),
    message: t('staff.unsaved.message', 'Your changes on this page are not saved yet.'),
    confirmLabel: t('staff.unsaved.leaveButton', 'Leave'),
    cancelLabel: t('staff.unsaved.stayButton', 'Stay'),
    danger: true,
  });
