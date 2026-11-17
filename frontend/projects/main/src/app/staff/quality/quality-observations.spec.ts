import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { AttentionService } from '../attention';
import { QualityObservationsPage } from './quality-observations-page';
import { QualityObservationsPanel } from './quality-observations-panel';
import { QoObservation, QoTarget, QoUnitView } from './quality.api';

const API = '/api/staff/quality-observations';

function obs(overrides: Partial<QoObservation> = {}): QoObservation {
  return {
    id: 101, zedId: 'ZEDMSME000001', certification: 'Silver', status: 'Open', text: 'No process sheet in the photo.', raisedOn: '2026-11-16T10:00:00',
    raisedBy: 'MASTER1S01', raisedByName: 'Ops One', round: 0, stage: 'Site', refType: 'Requirement', refId: '51', refLabel: '3.2 Process control',
    category: 'Conformance not justified', severity: 'Major', about: 'Lead', aboutUserId: 'SA1', aboutName: 'R Sharma', agencyId: 'AG1', agencyName: 'Acme',
    history: [{ kind: 'Raised', text: null, at: '2026-11-16T10:00:00', by: 'MASTER1S01', byName: 'Ops One' }], replyHours: null, closeHours: null, reopens: 0,
    ...overrides,
  };
}

function view(overrides: Partial<QoUnitView> = {}): QoUnitView {
  return { canRaise: true, canRespond: false, canClose: true, items: [], reasons: [{ id: 'conformance', text: 'Conformance not justified', severity: 'Major' }, { id: 'other', text: 'Other', severity: 'Minor' }], ...overrides };
}

@Component({
  imports: [QualityObservationsPanel],
  template: `<zed-qo-panel zedId="ZEDMSME000001" certification="Silver" [targets]="targets" [(target)]="target" />`,
})
class Host {
  targets: QoTarget[] = [{ type: 'Requirement', id: '51', label: '3.2 Process control' }];
  target = signal<QoTarget | null>(null);
}

describe('Quality observations (2026-11-16)', () => {
  let http: HttpTestingController;
  const role = signal(7);
  const attention = { refreshed: 0, refresh() { this.refreshed++; return Promise.resolve(null); } };

  async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    f.detectChanges();
    await new Promise((r) => setTimeout(r));
    await f.whenStable();
    f.detectChanges();
  }

  beforeEach(async () => {
    role.set(7);
    attention.refreshed = 0;
    await TestBed.configureTestingModule({
      imports: [Host, QualityObservationsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: AuthService, useValue: { currentUser: () => ({ roleId: role() }) } },
        { provide: AttentionService, useValue: attention }],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lets the ZED team raise an observation on a requirement of the page', async () => {
    const f = TestBed.createComponent(Host);
    const el: HTMLElement = f.nativeElement;
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view());
    await settle(f);
    expect(el.querySelector('[data-qo-panel]')!.textContent).toContain('No observations yet.');

    expect(el.querySelector('[data-qo-form]')).toBeNull();
    // A page's "+ Observation" on requirement 51 opens the pop-up on it.
    f.componentInstance.target.set({ type: 'Requirement', id: '51', label: '3.2 Process control' });
    await settle(f);
    const form = el.querySelector<HTMLFormElement>('[data-qo-form]')!;
    expect((form.querySelector('#qo-target') as HTMLSelectElement).value).toBe('Requirement|51');
    const set = (id: string, v: string) => {
      const e = form.querySelector<HTMLInputElement | HTMLSelectElement>(id)!;
      e.value = v;
      e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input'));
    };
    expect(form.querySelector('[data-qo-severity]')!.textContent).toContain('Choose the reason');
    set('#qo-category', 'conformance');
    set('#qo-text', 'No process sheet in the photo.');
    await settle(f);
    // 2026-11-17: the severity is the reason's (Admin → Observation reasons), shown, not chosen.
    expect(form.querySelector('#qo-severity')).toBeNull();
    expect(form.querySelector('[data-qo-severity]')!.textContent).toContain('Major');
    // The three severity cards, the reason's one marked; a major one warns that it holds the final submit.
    const cards = [...form.querySelectorAll<HTMLElement>('.qo-sev-card')];
    expect(cards.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Minor 1 point', 'Major 3 points', 'Critical 5 points']);
    expect(cards.map((c) => c.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(form.querySelector('.qo-warn')!.textContent).toContain("holds the agency's final submit");
    form.dispatchEvent(new Event('submit'));
    await settle(f);
    const post = http.expectOne((r) => r.method === 'POST' && r.url === `${API}/ZEDMSME000001/Silver`);
    expect(post.request.body).toEqual({
      refType: 'Requirement', refId: '51', refLabel: '3.2 Process control', category: 'conformance', about: 'Lead',
      text: 'No process sheet in the photo.',
    });
    post.flush({ message: 'Observation raised. The agency has been mailed.' });
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view({ items: [obs()] }));
    await settle(f);
    expect(el.querySelector('[data-qo-form]')).toBeNull();
    expect(attention.refreshed).toBe(1);
    expect(el.textContent).toContain('1 open');
    expect(el.querySelector('[data-qo="101"]')!.textContent).toContain('About Lead assessor: R Sharma');
  });

  it('lets the agency reply, and shows the time history', async () => {
    role.set(2);
    const f = TestBed.createComponent(Host);
    const el: HTMLElement = f.nativeElement;
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view({ canRaise: false, canClose: false, canRespond: true, items: [obs()] }));
    await settle(f);
    expect(el.querySelector('.qo-add')).toBeNull();
    el.querySelector<HTMLButtonElement>('.qo-toggle')!.click();
    await settle(f);
    expect(el.querySelector('[data-qo-history]')!.textContent).toContain('Raised');
    const box = el.querySelector<HTMLTextAreaElement>('[data-qo="101"] textarea')!;
    box.value = 'Re-checked in NC 1.';
    box.dispatchEvent(new Event('input'));
    await settle(f);
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Reply')!.click();
    await settle(f);
    const reply = http.expectOne(`${API}/items/101/respond`);
    expect(reply.request.body).toEqual({ text: 'Re-checked in NC 1.' });
    reply.flush({ message: 'Reply sent.' });
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view({ canRaise: false, canRespond: true, items: [obs({ status: 'Responded' })] }));
    await settle(f);
  });

  it('raises from the panel with the whose-work switch, and asks for the category and the text first', async () => {
    const f = TestBed.createComponent(Host);
    const el: HTMLElement = f.nativeElement;
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view());
    await settle(f);
    el.querySelector<HTMLButtonElement>('.qo-add')!.click();
    await settle(f);
    const form = el.querySelector<HTMLFormElement>('[data-qo-form]')!;
    expect((form.querySelector('#qo-target') as HTMLSelectElement).value).toBe('Overall|');
    form.querySelector<HTMLButtonElement>('[data-about="Agency"]')!.click();
    await settle(f);
    expect(form.querySelector('[data-about="Agency"]')!.getAttribute('aria-checked')).toBe('true');
    form.dispatchEvent(new Event('submit'));
    await settle(f);
    expect(form.textContent).toContain('Please choose the category.');
    const cat = form.querySelector<HTMLSelectElement>('#qo-category')!;
    cat.value = 'other';
    cat.dispatchEvent(new Event('change'));
    await settle(f);
    // A minor reason does not hold the final submit.
    expect(form.querySelector('.qo-warn')).toBeNull();
    form.dispatchEvent(new Event('submit'));
    await settle(f);
    expect(form.textContent).toContain('Please write the observation.');
    const text = form.querySelector<HTMLTextAreaElement>('#qo-text')!;
    text.value = 'Photo has no date.';
    text.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit'));
    await settle(f);
    const post = http.expectOne((r) => r.method === 'POST');
    expect(post.request.body).toEqual({ refType: 'Overall', refId: null, refLabel: null, category: 'other', about: 'Agency', text: 'Photo has no date.' });
    post.flush({ message: 'Observation raised.' });
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view());
    await settle(f);
  });

  it('keeps Reopen disabled until the reason is typed', async () => {
    const f = TestBed.createComponent(Host);
    const el: HTMLElement = f.nativeElement;
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view({ items: [obs({ status: 'Closed' })] }));
    await settle(f);
    const reopen = () => [...el.querySelectorAll<HTMLButtonElement>('[data-qo="101"] button')].find((b) => b.textContent!.trim() === 'Reopen')!;
    expect(reopen().disabled).toBe(true);
    const box = el.querySelector<HTMLTextAreaElement>('[data-qo="101"] textarea')!;
    box.value = 'Location stamp still missing.';
    box.dispatchEvent(new Event('input'));
    await settle(f);
    expect(reopen().disabled).toBe(false);
    reopen().click();
    await settle(f);
    http.expectOne(`${API}/items/101/reopen`).flush({ message: 'Reopened.' });
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view({ items: [obs()] }));
    await settle(f);
    expect(attention.refreshed).toBe(1);
  });

  it("opens the list of open observations from the header bell's link (?status=Open)", async () => {
    await TestBed.inject(Router).navigate([], { queryParams: { status: 'Open' } });
    const f = TestBed.createComponent(QualityObservationsPage);
    const el: HTMLElement = f.nativeElement;
    await settle(f);
    http.expectOne(`${API}?days=90`).flush({ items: [obs(), obs({ id: 102, status: 'Closed' })], canClose: true });
    await settle(f);
    http.expectOne(`${API}/dashboard?days=90`).flush({ agencies: [], assessors: [], total: 2, open: 1, responded: 0, closed: 1, avgReplyHours: null, avgCloseHours: null, categories: [] });
    await settle(f);
    expect(el.querySelectorAll('[data-qo]').length).toBe(1);
    expect(el.querySelector('[data-qo="101"]')).not.toBeNull();
    const on = el.querySelector('.cf-chip.on')!;
    expect(on.textContent!.replace(/\s+/g, ' ').trim()).toBe('Open 1');
  });

  it('asks for nothing when the login cannot see observations (an MSME)', async () => {
    role.set(4);
    const f = TestBed.createComponent(Host);
    await settle(f);
    http.expectNone(`${API}/ZEDMSME000001/Silver`);
  });

  it('shows the Master Admin the dashboard with the ranking of agencies and assessors', async () => {
    const f = TestBed.createComponent(QualityObservationsPage);
    const el: HTMLElement = f.nativeElement;
    await settle(f);
    http.expectOne(`${API}?days=90`).flush({ items: [obs()], canClose: true });
    await settle(f);
    const standing = { kind: 'Agency', userId: 'AG1', name: 'Acme', agencyId: null, assessments: 2, total: 3, open: 1, responded: 1, closed: 1, minor: 1, major: 2,
      critical: 0, reopens: 1, avgReplyHours: 10, avgCloseHours: 72, score: 3.5, rank: 1 };
    http.expectOne(`${API}/dashboard?days=90`).flush({
      agencies: [standing], assessors: [{ ...standing, kind: 'Assessor', userId: 'SA1', name: 'R Sharma', agencyId: 'AG1' }],
      total: 3, open: 1, responded: 1, closed: 1, avgReplyHours: 10, avgCloseHours: 72, categories: [{ category: 'Conformance not justified', total: 3, major: 2 }],
    });
    await settle(f);
    expect(el.querySelector('[data-qo-tiles]')!.textContent).toContain('3 days');
    const cells = [...el.querySelectorAll('[data-qo-rank="Assessment agencies"] tbody tr td')].map((td) => td.textContent!.replace(/\s+/g, ' ').trim());
    expect(cells).toEqual(['1', 'Acme AG1', '2', '1', '1', '1 / 2 / 0', '1', '10 h', '3 days', '3.5']);
    expect(el.querySelector('[data-qo-rank="Assessors"]')!.textContent).toContain('R Sharma');
    // The open count is coloured; the category is a bar with its major / critical share; the scoring rule has its card.
    expect(el.querySelector('[data-qo-rank="Assessment agencies"] .qo-open.on')!.textContent!.trim()).toBe('1');
    expect(el.querySelector<HTMLElement>('[data-qo-categories] .qo-bar-all')!.style.width).toBe('100%');
    expect(el.querySelector<HTMLElement>('[data-qo-categories] .qo-bar-major')!.style.width).toBe('66.7%');
    expect(el.querySelector('[data-qo-score]')!.textContent).toContain('minor 1, major 3, critical 5');
    expect([...el.querySelectorAll('zed-page-head button')].map((b) => b.textContent!.trim())).toEqual(['Download ranking (CSV)']);
  });
});
