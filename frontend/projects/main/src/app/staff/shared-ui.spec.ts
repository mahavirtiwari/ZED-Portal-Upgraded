import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { ListCount, ListCounts } from './list-counts';
import { ChipFilter, FilterChip } from './chip-filter';
import { RowMenu, RowMenuItem } from './row-menu';
import { ConfirmAsk, ConfirmDialog, ConfirmHost, ConfirmService } from './confirm-dialog';
import { ReasonDialog } from './users/reason-dialog';
import { ToastHost, ToastService } from './toast';
import { ATTENTION_API, AttentionBell, AttentionService } from './attention';
import { ZedIdSearch } from './zed-id-search';
import { staffCrumbs } from './staff-crumbs';
import { PageHead } from '../msme/shared/page-head';
import { StepTracker } from '../msme/shared/step-tracker';

/** 2026-11-17 (approved staff redesign): the shared building blocks of the staff pages. */
describe('staff shared UI', () => {
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  describe('zed-list-counts', () => {
    @Component({
      imports: [ListCounts],
      template: `
        <zed-list-counts id="plain" [counts]="counts" />
        <zed-list-counts id="pick" [counts]="counts" [selected]="selected()" label="Agencies by status" (pick)="selected.set($event.key ?? $event.label)" />
      `,
    })
    class Host {
      readonly counts: ListCount[] = [
        { label: 'Agencies', value: 3, key: 'all' },
        { label: 'Active', value: 3, tone: 'good', sub: '1 this month', delta: '+1' },
        { label: 'In-active', value: 0, tone: 'bad', delta: '-2' },
      ];
      readonly selected = signal<string | null>('all');
    }

    it('shows plain tiles as before, and clickable tiles with the chosen one outlined', async () => {
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      const plain = el.querySelector('#plain')!;
      expect(plain.querySelectorAll('button').length).toBe(0);
      expect(plain.querySelectorAll('[role="listitem"]').length).toBe(3);
      expect(plain.querySelector('b.is-good')!.textContent).toBe('3');
      expect(text(plain.querySelectorAll('.lc-item')[1])).toContain('1 this month');
      expect(plain.querySelector('.lc-delta.down')!.textContent!.trim()).toBe('-2');

      const pick = el.querySelector('#pick')!;
      expect(pick.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Agencies by status');
      const tiles = Array.from(pick.querySelectorAll('button'));
      expect(tiles.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
      tiles[1].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.selected()).toBe('Active');
      expect(tiles.map((b) => b.classList.contains('on'))).toEqual([false, true, false]);
    });
  });

  describe('zed-chip-filter', () => {
    @Component({ imports: [ChipFilter], template: `<zed-chip-filter label="Status" [chips]="chips" [(value)]="status" />` })
    class Host {
      readonly chips: FilterChip[] = [{ key: '', label: 'All', count: 3 }, { key: 'A', label: 'Active' }, { key: 'I', label: 'In-active', count: 0 }];
      readonly status = signal('');
    }

    it('chooses one chip at a time and shows the counts', async () => {
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Status');
      const chips = Array.from(el.querySelectorAll('button'));
      expect(chips.map((c) => text(c))).toEqual(['All 3', 'Active', 'In-active 0']);
      expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
      chips[2].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.status()).toBe('I');
      expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    });
  });

  describe('zed-row-menu', () => {
    @Component({
      imports: [RowMenu],
      template: `<button id="outside">x</button><zed-row-menu [items]="items" label="More actions for Mahavir Agency" (picked)="picked.push($event)" />`,
    })
    class Host {
      readonly items: RowMenuItem[] = [
        { key: 'edit', label: 'Edit agency', icon: 'edit' },
        { key: 'reset', label: 'Send reset link', icon: 'mail' },
        { key: 'off', label: 'Not now', disabled: true },
        { key: 'block', label: 'Block agency', icon: 'lock', danger: true },
      ];
      readonly picked: string[] = [];
    }

    async function setup() {
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      const trigger = el.querySelector('.rm-btn') as HTMLButtonElement;
      return { fixture, el, trigger };
    }

    it('opens a menu with the danger item last, below a line, and gives the chosen key', async () => {
      const { fixture, el, trigger } = await setup();
      expect(trigger.getAttribute('aria-label')).toBe('More actions for Mahavir Agency');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      trigger.click();
      await fixture.whenStable();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      const menu = el.querySelector('[role="menu"]')!;
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
      expect(items.map((i) => text(i))).toEqual(['Edit agency', 'Send reset link', 'Not now', 'Block agency']);
      expect(menu.children[3].getAttribute('role')).toBe('separator');
      expect(items[3].classList).toContain('danger');
      expect(items[2].disabled).toBe(true);
      expect(document.activeElement).toBe(items[0]);
      items[1].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.picked).toEqual(['reset']);
      expect(el.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    // 2026-11-19 (the user, Admin login: 'make the buttons in dark color').
    it('draws the "⋯" button solid dark with white dots inside the Admin frame only', async () => {
      const { fixture, el, trigger } = await setup();
      expect(getComputedStyle(trigger).backgroundColor).not.toBe('rgb(61, 90, 94)');
      el.classList.add('zed-admin');
      await fixture.whenStable();
      expect(getComputedStyle(trigger).backgroundColor).toBe('rgb(61, 90, 94)');
      expect(getComputedStyle(trigger).color).toBe('rgb(255, 255, 255)');
    });

    it('moves with the arrow keys past disabled items, and closes on Esc or a click outside', async () => {
      const { fixture, el, trigger } = await setup();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await fixture.whenStable();
      const menu = el.querySelector('[role="menu"]') as HTMLElement;
      const key = (k: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      key('ArrowDown');
      expect(text(document.activeElement)).toBe('Send reset link');
      key('ArrowDown');
      expect(text(document.activeElement)).toBe('Block agency');
      key('ArrowDown');
      expect(text(document.activeElement)).toBe('Edit agency');
      key('End');
      expect(text(document.activeElement)).toBe('Block agency');
      key('Escape');
      await fixture.whenStable();
      expect(el.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(menu.isConnected).toBe(false);

      trigger.click();
      await fixture.whenStable();
      expect(el.querySelector('[role="menu"]')).not.toBeNull();
      (el.querySelector('#outside') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(el.querySelector('[role="menu"]')).toBeNull();
      expect(fixture.componentInstance.picked).toEqual([]);
    });
  });

  describe('zed-confirm-dialog', () => {
    @Component({
      imports: [ConfirmDialog],
      template: `<zed-confirm-dialog [ask]="ask()" [failed]="failed()" (confirmed)="done.push($event)" (cancel)="cancelled = cancelled + 1" />`,
    })
    class Host {
      readonly ask = signal<ConfirmAsk>({
        title: 'Block Mahavir Agency', message: 'The agency cannot sign in until it is unblocked.', confirmLabel: 'Block', danger: true,
        reason: { label: 'Why it is blocked', hint: 'Kept in the history.' },
      });
      readonly failed = signal('');
      readonly done: string[] = [];
      cancelled = 0;
    }

    it('asks for a required reason, then confirms with it; a danger action has a red button', async () => {
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      const dialog = el.querySelector('[role="dialog"]')!;
      expect(text(el.querySelector('h3'))).toBe('Block Mahavir Agency');
      expect(dialog.getAttribute('aria-describedby')).toBe(el.querySelector('.cd-msg')!.id);
      const ok = el.querySelector('.cd-ok') as HTMLButtonElement;
      expect(ok.classList).toContain('btn-danger');
      expect(text(ok)).toBe('Block');
      const box = el.querySelector('textarea') as HTMLTextAreaElement;
      expect(document.activeElement).toBe(box);
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      expect(text(el.querySelector('[role="alert"]'))).toBe('Please enter the reason.');
      expect(fixture.componentInstance.done).toEqual([]);
      box.value = '  Repeated delays  ';
      box.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      expect(fixture.componentInstance.done).toEqual(['Repeated delays']);

      fixture.componentInstance.failed.set('Not allowed.');
      await fixture.whenStable();
      expect(text(el.querySelector('[role="alert"]'))).toBe('Not allowed.');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(fixture.componentInstance.cancelled).toBe(1);
    });

    it("the pages' ConfirmService asks in the layout's pop-up and answers true / false (2026-11-19, no browser confirm box)", async () => {
      const fixture = TestBed.createComponent(ConfirmHost);
      const service = TestBed.inject(ConfirmService);
      const el: HTMLElement = fixture.nativeElement;
      await fixture.whenStable();
      expect(el.querySelector('[role="dialog"]')).toBeNull();

      const yes = service.ask({ title: 'Reset to the Standard Text?', message: 'The saved text is removed.', confirmLabel: 'Reset', danger: true });
      await fixture.whenStable();
      expect(text(el.querySelector('h3'))).toBe('Reset to the Standard Text?');
      expect(text(el.querySelector('.cd-ok'))).toBe('Reset');
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      expect(await yes).toBe(true);
      await fixture.whenStable();
      expect(el.querySelector('[role="dialog"]')).toBeNull();

      const no = service.ask({ title: 'Switch the Item Off?' });
      await fixture.whenStable();
      (el.querySelector('.cd-no') as HTMLButtonElement).click();
      expect(await no).toBe(false);

      // A newer question answers the open one false.
      const first = service.ask({ title: 'First' });
      const second = service.ask({ title: 'Second' });
      expect(await first).toBe(false);
      await fixture.whenStable();
      expect(text(el.querySelector('h3'))).toBe('Second');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(await second).toBe(false);
    });

    it('confirms at once without a reason, with a teal button', async () => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.ask.set({ title: 'Send the reset link?', message: 'It is e-mailed to the SPOC.', confirmLabel: 'Send link' });
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('textarea')).toBeNull();
      expect(el.querySelector('.cd-ok')!.classList).toContain('btn-primary');
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      expect(fixture.componentInstance.done).toEqual(['']);
    });

    // 2026-11-19 (Admin UI audit: pop-ups taller than the window, the buttons off-screen): one frame for every staff pop-up.
    it('has the staff pop-up frame: a fixed head, a body that scrolls inside, Cancel left of the main action', async () => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.ask.set({
        title: 'Disable the Sector Manufacturing of Food Products and Beverages', subtitle: 'Code 10 · used by 12 units',
        points: Array.from({ length: 30 }, (_, i) => `Effect ${i + 1}`), confirmLabel: 'Disable', danger: true,
      });
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      const content = el.querySelector('.modal-content.cd')!;
      // Head, then the form with the body and the buttons: the body is the only part that scrolls.
      expect([...content.children].map((c) => c.tagName === 'FORM' ? 'form' : c.className)).toEqual(['cd-head', 'form']);
      expect([...content.querySelector('form')!.children].map((c) => c.className)).toEqual(['cd-body', 'cd-foot']);
      const body = el.querySelector('.cd-body') as HTMLElement;
      expect(getComputedStyle(body).overflowY).toBe('auto');
      expect(getComputedStyle(content).display).toBe('flex');
      expect(getComputedStyle(content).flexDirection).toBe('column');
      expect(getComputedStyle(el.querySelector('.cd-head')!).flexShrink).toBe('0');
      expect(getComputedStyle(el.querySelector('.cd-foot')!).flexShrink).toBe('0');
      // Cancel first (left), the main action last (right); the 32px close button in the head.
      expect([...el.querySelectorAll('.cd-foot .btn')].map((b) => text(b))).toEqual(['Cancel', 'Disable']);
      expect(el.querySelector('.cd-head .cd-x')!.getAttribute('aria-label')).toBe('Close');
      expect(text(el.querySelector('.cd-titles small'))).toBe('Code 10 · used by 12 units');
      expect(el.querySelectorAll('.cd-pts li').length).toBe(30);
    });

    it('keeps ReasonDialog working on top of it', async () => {
      @Component({
        imports: [ReasonDialog],
        template: `<zed-reason-dialog [ask]="{ action: 'unblock', userId: 'ZEDAA0080', userName: null }" (confirmed)="done.push($event)" />`,
      })
      class ReasonHost {
        readonly done: string[] = [];
      }
      const fixture = TestBed.createComponent(ReasonHost);
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      expect(text(el.querySelector('zed-reason-dialog h3'))).toBe('Unblock ZEDAA0080');
      expect(el.querySelector('.cd-ok')!.classList).toContain('btn-primary');
      const box = el.querySelector('#reason-dialog-text') as HTMLTextAreaElement;
      box.value = 'Cleared';
      box.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      (el.querySelector('zed-reason-dialog form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      expect(fixture.componentInstance.done).toEqual(['Cleared']);
    });
  });

  describe('zed-toast', () => {
    afterEach(() => vi.useRealTimers());

    it('shows a success message bottom right and hides it after a few seconds; an error stays longer and can be closed', async () => {
      vi.useFakeTimers();
      const fixture = TestBed.createComponent(ToastHost);
      const toasts = TestBed.inject(ToastService);
      const el: HTMLElement = fixture.nativeElement;
      toasts.success('Reset link sent', 'E-mailed to deepa@qcin.org');
      toasts.error('Not saved', 'Please try again.');
      fixture.detectChanges();
      expect(text(el.querySelector('[role="status"] .tt'))).toContain('Reset link sent E-mailed to deepa@qcin.org');
      expect(text(el.querySelector('[role="alert"] .tt'))).toContain('Not saved');
      expect(el.textContent).not.toContain('Undo');
      vi.advanceTimersByTime(5000);
      fixture.detectChanges();
      expect(el.querySelector('[data-tone="success"]')).toBeNull();
      expect(el.querySelector('[data-tone="error"]')).not.toBeNull();
      (el.querySelector('.tt-x') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(toasts.toasts()).toEqual([]);
    });
  });

  describe('header', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    });

    it('the bell shows the total and links each count to its page', async () => {
      const fixture = TestBed.createComponent(AttentionBell);
      const http = TestBed.inject(HttpTestingController);
      http.expectOne(ATTENTION_API).flush({
        total: 9,
        items: [
          { key: 'allot', label: 'Units awaiting allotment', count: 9, link: '/staff/assessment/allot', query: { type: 'ALLOT' }, tone: 'warn', icon: 'people' },
          { key: 'nc-overdue', label: 'NC closures overdue', count: 0, link: '/staff/monitoring', query: { status: '4' }, tone: 'bad', icon: 'clock' },
        ],
      });
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-total]')!.textContent).toBe('9');
      const button = el.querySelector('.ab-btn') as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBe('Needs your attention, 9 waiting');
      button.click();
      await fixture.whenStable();
      const links = Array.from(el.querySelectorAll('.ab-list a'));
      expect(links.map((a) => text(a))).toEqual(['9 Units awaiting allotment', '0 NC closures overdue']);
      expect(links[0].getAttribute('href')).toBe('/staff/assessment/allot?type=ALLOT');
      expect(links[1].classList).toContain('ab-zero');

      // After a change a page asks for fresh counts.
      const refreshed = TestBed.inject(AttentionService).refresh();
      const fresh = http.expectOne((r) => r.url === ATTENTION_API);
      expect(fresh.request.params.get('fresh')).toBe('true');
      fresh.flush({ total: 0, items: [] });
      await refreshed;
      fixture.detectChanges();
      await fixture.whenStable();
      expect(el.querySelector('[data-total]')).toBeNull();
      expect(el.querySelector('[data-nothing]')).not.toBeNull();
      http.verify();
    });

    it('the search box opens a ZED ID profile, refuses what is not a ZED ID, and Ctrl+K goes to it', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = TestBed.createComponent(ZedIdSearch);
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      const box = el.querySelector('input') as HTMLInputElement;
      expect(box.getAttribute('aria-label')).toBe('Search ZED ID');
      expect(el.querySelector('kbd')!.textContent).toBe('Ctrl K');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }));
      expect(document.activeElement).toBe(box);

      box.value = 'hello world';
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      expect(text(el.querySelector('[role="alert"]'))).toContain('This is not a ZED ID');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(navigate).not.toHaveBeenCalled();

      box.value = '  zedmsme000001 ';
      box.dispatchEvent(new Event('input'));
      el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledWith(['/staff/msme-profile', 'ZEDMSME000001']);
      expect(el.querySelector('[role="alert"]')).toBeNull();
      expect(box.value).toBe('');
    });
  });

  describe('page head and step tracker on staff pages', () => {
    @Component({
      imports: [PageHead, StepTracker],
      template: `
        <zed-page-head [crumbs]="crumbs" title="Pump Engineers · Bronze" subtitle="Certified on 14 Nov 2026">
          <button type="button" class="btn btn-ph">Refresh</button>
        </zed-page-head>
        <zed-step-tracker [steps]="steps" [current]="5" label="Assessment progress" />
      `,
    })
    class Host {
      readonly crumbs = staffCrumbs({ label: 'Completed Assessment', link: '/staff/assessment/completed', fragment: 'list' }, { label: 'ZEDM000005' });
      readonly steps = [{ label: 'Documents submitted', note: '13 Nov 2026' }, { label: 'Allotted' }, { label: 'NCs closed', note: '2 of 2' },
        { label: 'Verified' }, { label: 'Certified', note: '14 Nov 2026' }];
    }

    it('starts the crumbs at the staff Home and marks every step done', async () => {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      const el: HTMLElement = fixture.nativeElement;
      const links = Array.from(el.querySelectorAll('.ph-crumb a'));
      expect(links.map((a) => [text(a), a.getAttribute('href')])).toEqual([['Home', '/staff'], ['Completed Assessment', '/staff/assessment/completed#list']]);
      expect(text(el.querySelector('[aria-current="page"]'))).toBe('ZEDM000005');
      expect(text(el.querySelector('.ph-sub'))).toBe('Certified on 14 Nov 2026');
      expect(el.querySelector('.ph-actions .btn-ph')).not.toBeNull();
      expect(el.querySelectorAll('.st-done').length).toBe(5);
      expect(el.querySelector('ol')!.getAttribute('aria-label')).toBe('Assessment progress');
    });
  });
});
