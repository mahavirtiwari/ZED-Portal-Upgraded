import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlertDialog, AlertMessage, errorAlert, successAlert } from './alert-dialog';

@Component({
  imports: [AlertDialog],
  template: `<zed-alert-dialog [message]="alert()" (closed)="alert.set(null)" />`,
})
class Host {
  readonly alert = signal<AlertMessage | null>(null);
}

describe('AlertDialog', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  const dialog = () => el.querySelector('[role="dialog"]') as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('renders nothing without a message', () => {
    expect(dialog()).toBeNull();
  });

  it('shows the legacy "Error!" pop-up and closes on OK', () => {
    fixture.componentInstance.alert.set(errorAlert('Please enter required data.'));
    fixture.detectChanges();
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.querySelector('.swal-icon--error')).not.toBeNull();
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Error!');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)!.textContent).toBe('Please enter required data.');

    (d.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(dialog()).toBeNull();
    expect(fixture.componentInstance.alert()).toBeNull();
  });

  it('shows "Success!" and closes on Escape', () => {
    fixture.componentInstance.alert.set(successAlert('PAN updated successfully. Proceeding...'));
    fixture.detectChanges();
    expect(dialog()!.querySelector('.swal-title')!.textContent).toBe('Success!');
    expect(dialog()!.querySelector('.swal-icon--success')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(dialog()).toBeNull();
  });

  it('closes on a click outside the box but not inside it', () => {
    fixture.componentInstance.alert.set(errorAlert('x'));
    fixture.detectChanges();
    dialog()!.click();
    fixture.detectChanges();
    expect(dialog()).not.toBeNull();
    (el.querySelector('.swal-overlay') as HTMLElement).click();
    fixture.detectChanges();
    expect(dialog()).toBeNull();
  });
});
