import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { Component } from '@angular/core';
import { EnvironmentLabelService, EnvironmentTitleStrategy } from '@zed/shared';
import { App } from './app';

@Component({ template: 'page' })
class Page {}

describe('test environment label', () => {
  let http: HttpTestingController;

  async function create(label: string | null) {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', title: 'ZED | Login', component: Page }]),
        { provide: TitleStrategy, useClass: EnvironmentTitleStrategy },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne('/api/config').flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '', environmentLabel: label });
    await fixture.whenStable();
    await TestBed.inject(Router).navigateByUrl('/login');
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => http.verify());

  it('shows the ribbon and prefixes the title when a label is set', async () => {
    const el = await create('STAGING');
    expect(el.querySelector('.zed-environment-banner')!.textContent).toContain('STAGING: test environment');
    expect(TestBed.inject(Title).getTitle()).toBe('[STAGING] ZED | Login');
    // Not doubled.
    expect(TestBed.inject(EnvironmentLabelService).prefixed('[STAGING] ZED | Login')).toBe('[STAGING] ZED | Login');
  });

  it('shows nothing without a label (Production)', async () => {
    const el = await create(null);
    expect(el.querySelector('.zed-environment-banner')).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('ZED | Login');
  });
});
