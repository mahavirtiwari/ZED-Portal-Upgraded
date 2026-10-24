import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Recaptcha } from '@zed/shared';

@Component({
  imports: [Recaptcha],
  template: `<zed-recaptcha label="Verification" (token)="tokens.push($event)" />`,
})
class Host {
  readonly tokens: string[] = [];
  readonly captcha = viewChild.required(Recaptcha);
}

/** The forms' captcha in the modes the Admin chooses (Captcha Settings). */
describe('Recaptcha', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create(config: object) {
    await TestBed.configureTestingModule({ imports: [Host], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/config').flush(config);
    await settle();
  }

  const type = (value: string) => {
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  afterEach(() => http.verify());

  it('shows nothing and lets the form through when the captcha is off', async () => {
    await create({ captchaEnabled: false, captchaMode: 'off', captchaSiteKey: '' });
    expect(fixture.componentInstance.tokens).toEqual(['disabled']);
    expect(el.textContent!.trim()).toBe('');
  });

  it('shows the 6-character picture and sends "id.ANSWER" once 6 characters are typed', async () => {
    await create({ captchaEnabled: true, captchaMode: 'text', captchaSiteKey: '' });
    http.expectOne('/api/captcha').flush({ id: 'a1', image: 'data:image/png;base64,AAAA' });
    await settle();
    expect(el.querySelector('label')!.textContent).toBe('Verification');
    expect(el.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');

    type('ab2');
    type('ab2-c3d4x');
    await settle();
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('AB2C3D');
    expect(fixture.componentInstance.tokens.at(-2)).toBe('');
    expect(fixture.componentInstance.tokens.at(-1)).toBe('a1.AB2C3D');

    // After a failed submit the form asks for a new picture: the answer is cleared.
    fixture.componentInstance.captcha().reset();
    http.expectOne('/api/captcha').flush({ id: 'b2', image: 'data:image/png;base64,BBBB' });
    await settle();
    expect(fixture.componentInstance.tokens.at(-1)).toBe('');
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('');

    (el.querySelector('button[aria-label="Show a new captcha"]') as HTMLButtonElement).click();
    http.expectOne('/api/captcha').flush(null, { status: 500, statusText: 'Error' });
    await settle();
    expect(el.textContent).toContain('The captcha could not be loaded.');
  });
});
