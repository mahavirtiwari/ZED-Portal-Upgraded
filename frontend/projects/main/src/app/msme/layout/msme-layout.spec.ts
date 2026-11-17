import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BHASHINI_PLUGIN_SRC, BhashiniMenu } from './bhashini-menu';
import { MsmeLayout, sectionOf } from './msme-layout';
import { NOTIFICATIONS_API, NotificationBell } from './notification-bell';

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('MsmeLayout (2026-11-17 applicant designs)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MsmeLayout],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    document.querySelectorAll('script[data-zed-bhashini]').forEach((s) => s.remove());
    delete (window as { __zedBhashiniHost?: HTMLElement }).__zedBhashiniHost;
  });

  it('shows the six menu items, the Bhashini language menu and the bell', async () => {
    const fixture = TestBed.createComponent(MsmeLayout);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    for (const r of http.match(() => true)) r.flush(r.request.url === NOTIFICATIONS_API ? { unread: 0, items: [] } : null);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect([...el.querySelectorAll('#msme-menu .me-auto .nav-link')].map((a) => a.textContent!.trim()))
      .toEqual(['Home', 'Certifications', 'Incentives', 'My Documents', 'Profile', 'Help']);
    expect(el.querySelector('zed-bhashini-menu .bhashini-plugin-container')).not.toBeNull();
    expect(document.querySelector(`script[src="${BHASHINI_PLUGIN_SRC}"]`)!.getAttribute('language-icon-color')).toBe('#ffffff');
    expect(el.querySelector('zed-notification-bell')).not.toBeNull();
    expect(el.querySelector('.msme-footer')!.textContent).toContain('All Rights Reserved');
  });

  it('marks the menu item of each page', () => {
    expect(sectionOf('/msme/dashboard')).toBe('home');
    expect(sectionOf('/msme/dashboard#certifications')).toBe('certifications');
    expect(sectionOf('/msme/certification/Silver')).toBe('certifications');
    expect(sectionOf('/msme/payment/result?x=1')).toBe('certifications');
    expect(sectionOf('/msme/handholding/Silver/payment')).toBe('incentives');
    expect(sectionOf('/msme/financial-assistance')).toBe('incentives');
    expect(sectionOf('/msme/change-password')).toBe('profile');
    expect(sectionOf('/msme/documents')).toBe('other');
  });
});

@Component({ imports: [BhashiniMenu], template: `@if (show) { <zed-bhashini-menu /> }` })
class BhashiniHost {
  show = true;
}

describe('BhashiniMenu', () => {
  afterEach(() => {
    document.querySelectorAll('script[data-zed-bhashini]').forEach((s) => s.remove());
    delete (window as { __zedBhashiniHost?: HTMLElement }).__zedBhashiniHost;
  });

  it('loads the plugin once and gives its menu back to the next header', async () => {
    const fixture = TestBed.configureTestingModule({ imports: [BhashiniHost] }).createComponent(BhashiniHost);
    fixture.detectChanges();
    const container = fixture.nativeElement.querySelector('.bhashini-plugin-container') as HTMLElement;
    container.textContent = 'menu built by the plugin';
    fixture.componentInstance.show = false;
    fixture.detectChanges();
    fixture.componentInstance.show = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bhashini-plugin-container')).toBe(container);
    expect(document.querySelectorAll('script[data-zed-bhashini]').length).toBe(1);
  });
});

describe('NotificationBell', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NotificationBell], providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  it('shows the unread count, lists the notifications and marks them read when opened', async () => {
    const fixture = TestBed.createComponent(NotificationBell);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(NOTIFICATIONS_API).flush({
      unread: 1,
      items: [
        { at: '2026-11-17T10:00:00', text: 'Payment of Rs. 0 successfully received', level: 'Silver', module: 'Handholding' },
        { at: '2026-11-14T10:00:00', text: 'Desktop verification completed', level: 'Bronze', module: 'Certification' },
      ],
    });
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-unread]')!.textContent!.trim()).toBe('1');

    (el.querySelector('.nb-btn') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne({ method: 'POST', url: `${NOTIFICATIONS_API}/seen` }).flush(null);
    expect(el.querySelector('[data-unread]')).toBeNull();
    const items = [...el.querySelectorAll('.nb-list li')];
    expect(items.length).toBe(2);
    expect(items[0].classList).toContain('nb-new');
    expect(items[0].textContent).toContain('Silver · Handholding');
    expect(items[1].classList).not.toContain('nb-new');
    http.verify();
  });

  it('says so when there is nothing yet', async () => {
    const fixture = TestBed.createComponent(NotificationBell);
    TestBed.inject(HttpTestingController).expectOne(NOTIFICATIONS_API).flush({ unread: 0, items: [] });
    await settle(fixture);
    (fixture.nativeElement.querySelector('.nb-btn') as HTMLButtonElement).click();
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-no-notifications]')).not.toBeNull();
  });
});
