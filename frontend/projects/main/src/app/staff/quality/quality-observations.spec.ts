import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@zed/shared';
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
  return { canRaise: true, canRespond: false, canClose: true, items: [], categories: ['Conformance not justified', 'Other'], severities: ['Minor', 'Major', 'Critical'], ...overrides };
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

  async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    f.detectChanges();
    await new Promise((r) => setTimeout(r));
    await f.whenStable();
    f.detectChanges();
  }

  beforeEach(async () => {
    role.set(7);
    await TestBed.configureTestingModule({
      imports: [Host, QualityObservationsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { currentUser: () => ({ roleId: role() }) } }],
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

    // A page's "+ Observation" on requirement 51 opens the form on it.
    f.componentInstance.target.set({ type: 'Requirement', id: '51', label: '3.2 Process control' });
    await settle(f);
    const form = el.querySelector<HTMLFormElement>('[data-qo-form]')!;
    expect((form.querySelector('#qo-target') as HTMLSelectElement).value).toBe('Requirement|51');
    const set = (id: string, v: string) => {
      const e = form.querySelector<HTMLInputElement | HTMLSelectElement>(id)!;
      e.value = v;
      e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input'));
    };
    set('#qo-category', 'Conformance not justified');
    set('#qo-severity', 'Major');
    set('#qo-text', 'No process sheet in the photo.');
    await settle(f);
    form.dispatchEvent(new Event('submit'));
    await settle(f);
    const post = http.expectOne((r) => r.method === 'POST' && r.url === `${API}/ZEDMSME000001/Silver`);
    expect(post.request.body).toEqual({
      refType: 'Requirement', refId: '51', refLabel: '3.2 Process control', category: 'Conformance not justified', severity: 'Major', about: 'Lead',
      text: 'No process sheet in the photo.',
    });
    post.flush({ message: 'Observation raised. The agency has been mailed.' });
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view({ items: [obs()] }));
    await settle(f);
    expect(el.textContent).toContain('1 open');
    expect(el.querySelector('[data-qo="101"]')!.textContent).toContain('about Lead assessor: R Sharma');
  });

  it('lets the agency reply, and shows the time history', async () => {
    role.set(2);
    const f = TestBed.createComponent(Host);
    const el: HTMLElement = f.nativeElement;
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view({ canRaise: false, canClose: false, canRespond: true, items: [obs()] }));
    await settle(f);
    expect(el.querySelector('button.btn-primary')?.textContent).not.toContain('OBSERVATION');
    el.querySelector<HTMLButtonElement>('.qo-toggle')!.click();
    await settle(f);
    expect(el.querySelector('[data-qo-history]')!.textContent).toContain('Raised');
    const box = el.querySelector<HTMLTextAreaElement>('[data-qo="101"] textarea')!;
    box.value = 'Re-checked in NC 1.';
    box.dispatchEvent(new Event('input'));
    await settle(f);
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'REPLY')!.click();
    await settle(f);
    const reply = http.expectOne(`${API}/items/101/respond`);
    expect(reply.request.body).toEqual({ text: 'Re-checked in NC 1.' });
    reply.flush({ message: 'Reply sent.' });
    await settle(f);
    http.expectOne(`${API}/ZEDMSME000001/Silver`).flush(view({ canRaise: false, canRespond: true, items: [obs({ status: 'Responded' })] }));
    await settle(f);
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
  });
});
