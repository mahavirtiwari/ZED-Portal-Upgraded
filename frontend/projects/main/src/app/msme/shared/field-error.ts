import { NgForm } from '@angular/forms';

/**
 * The legacy pages' message condition `Form.Field.$error.<error> && (Form.Field.$dirty || Form.$submitted)`
 * for a template-driven form: true when the control has that error and was edited or, unless
 * `whenSubmitted` is false, the form was submitted.
 */
export function fieldError(form: NgForm, name: string, error = 'required', whenSubmitted = true): boolean {
  const c = form.controls[name];
  return !!c?.hasError(error) && (c.dirty || (whenSubmitted && form.submitted));
}
