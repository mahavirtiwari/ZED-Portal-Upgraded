import { TestBed } from '@angular/core/testing';
import { FieldDialogComponent } from './field-dialog';
import { FormField } from './schemes-admin.api';

/** 2026-11-20 (phase 2): a checked field's "Checked at" (desktop / onsite / both) in the Desktop + Onsite flow. */
describe('FieldDialogComponent: checked at', () => {
  const field: FormField = { key: 'installed', label: 'Machine installed', type: 'yesno', required: true, assessorChecks: true, options: [], isClaim: false };

  async function render(onsiteFlow: boolean, f: FormField = field) {
    const fixture = TestBed.createComponent(FieldDialogComponent);
    fixture.componentRef.setInput('field', f);
    fixture.componentRef.setInput('onsiteFlow', onsiteFlow);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('asks where a checked field is checked only in the Desktop + Onsite flow, and saves the choice', async () => {
    expect((await render(false)).nativeElement.querySelector('#fd-stage')).toBeNull();

    const fixture = await render(true);
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector('#fd-stage') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent!.trim())).toEqual(['Desktop', 'Onsite (at the visit)', 'Desktop and onsite']);
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    (el.querySelector('#fd-ok') as HTMLButtonElement).click();
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ key: 'installed', checkStage: 'onsite' }));
  });

  it('stores nothing for the desktop default or a field the assessor does not check', async () => {
    const fixture = await render(true, { ...field, checkStage: 'both', assessorChecks: false });
    expect(fixture.nativeElement.querySelector('#fd-stage')).toBeNull();
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    (fixture.nativeElement.querySelector('#fd-ok') as HTMLButtonElement).click();
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ checkStage: null }));
  });
});
