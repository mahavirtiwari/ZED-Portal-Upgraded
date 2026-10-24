import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PrivacyPolicyPage } from './privacy-policy';

describe('PrivacyPolicyPage', () => {
  it('renders the public page without calling the API', async () => {
    await TestBed.configureTestingModule({ imports: [PrivacyPolicyPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(PrivacyPolicyPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('h3')?.textContent).toContain('Privacy Policy');
    expect(el.querySelector('a[href="/msme/login"]')).not.toBeNull();
    expect(el.querySelector('[data-key="public.privacyPolicy"]')).not.toBeNull();
  });
});
