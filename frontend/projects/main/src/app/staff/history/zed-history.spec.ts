import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HistoryRow, RECENT_KEY, ZedHistoryPage, buildTimeline, keyDates } from './zed-history';

const row = (o: Partial<HistoryRow>): HistoryRow => ({
  Source_DB: 'CERTIFICATION', ZedId: 'ZEDMSME000001', Description: '', CreatedDate: '2024-01-01T10:00:00',
  CertificationType: null, StatusType: null, MiletoneNo: '', ...o,
});

describe('buildTimeline', () => {
  it('groups by level and phase in date order', () => {
    const groups = buildTimeline([
      row({ CreatedDate: '2024-03-01T10:00:00', CertificationType: 'Bronze', StatusType: 'GetCertified', Description: 'Certified' }),
      row({ CreatedDate: '2024-01-01T10:00:00', Description: 'Registered with Udyam' }),
      row({ CreatedDate: '2025-03-01T10:00:00', CertificationType: 'Bronze', Source_DB: 'SURVEILLANCE', StatusType: 'NcRaised' }),
      row({ CreatedDate: '2024-02-01T10:00:00', CertificationType: 'Bronze', Description: 'Payment of Rs. 0 received' }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['Registration', 'Bronze Certification', 'Bronze Surveillance']);
    expect(groups[0].events[0].label).toBe('Registered on ZED Portal');
    expect(groups[1].events.map((e) => e.label)).toEqual(['Payment', 'Certified']);
    expect(groups[1].events[1].done).toBe(true);
    expect(groups[2].events[0].alert).toBe(true);
  });

  it('tags each event with who did it only where the line says so (2026-11-17)', () => {
    const [reg, bronze] = buildTimeline([
      row({ Description: 'Registered with Udyam' }),
      row({ CertificationType: 'Bronze', StatusType: 'BasicInfoStatus' }),
      row({ CertificationType: 'Bronze', StatusType: 'AgencyAlloted' }),
      row({ CertificationType: 'Bronze', StatusType: 'DocVerifiAllot' }),
      row({ CertificationType: 'Bronze', StatusType: 'NcRaised' }),
      row({ CertificationType: 'Bronze', StatusType: 'Completed' }),
      row({ CertificationType: 'Bronze', StatusType: 'DirectQC' }),
      row({ CertificationType: 'Bronze', StatusType: 'GetCertified' }),
      row({ CertificationType: 'Bronze', Description: 'Something else' }),
    ]);
    expect(reg.events[0].actor).toBe('MSME');
    expect(bronze.events.map((e) => e.actor)).toEqual(['MSME', 'ZED', 'Agency', 'Assessor', null, null, 'ZED', null]);
  });

  it('lists the key dates the history has', () => {
    const events = buildTimeline([
      row({ CreatedDate: '2026-11-13T10:00:00', Description: 'Registered on portal' }),
      row({ CreatedDate: '2026-11-13T11:00:00', CertificationType: 'Bronze', StatusType: 'ApplicationReceived' }),
      row({ CreatedDate: '2026-11-14T11:00:00', CertificationType: 'Bronze', StatusType: 'GetCertified' }),
    ]).flatMap((g) => g.events);
    expect(keyDates(events).map((k) => k.label)).toEqual(['Registered', 'Bronze applied', 'Bronze certified']);
  });
});

describe('ZedHistoryPage', () => {
  let fixture: ComponentFixture<ZedHistoryPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function search(value: string) {
    const input = el.querySelector('#zedId') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
    (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await settle();
  }

  beforeEach(async () => {
    localStorage.removeItem(RECENT_KEY);
    await TestBed.configureTestingModule({
      imports: [ZedHistoryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ZedHistoryPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  });

  afterEach(() => http.verify());

  it('does not send ZED IDs with wildcard characters', async () => {
    await search('ZED%');
    http.expectNone(() => true);
    expect(el.textContent).toContain('Please enter a valid ZED ID.');
  });

  it('shows the summary and the timeline of the searched unit', async () => {
    await search('zedmsme000001');
    http.expectOne('/api/staff/history/ZEDMSME000001').flush([
      row({ Description: 'Registered on portal' }),
      row({ CreatedDate: '2024-02-01T10:00:00', CertificationType: 'Bronze', StatusType: 'ApplicationReceived', Description: 'Payment received' }),
    ]);
    await settle();
    // The unit's header reads its profile.
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush({
      unit: { PUnitName: 'Pump Engineers', PDistrictName: 'East', PStateName: 'Delhi' }, enterprise: { UdyogAadharNo: 'UDYAM-UP-16-0001476', EnterpriseTypee: 'Micro' }, certifications: ['Bronze'],
    });
    await settle();
    expect(el.querySelector('.history-summary')!.textContent).toContain('ZEDMSME000001');
    expect(el.querySelectorAll('.tl-item').length).toBe(2);
    expect(el.textContent).toContain('Application Received');
    const unit = el.querySelector('[data-unit]')!;
    expect(unit.querySelector('h3')!.textContent).toContain('Pump Engineers');
    expect(unit.querySelector('h3')!.textContent).toContain('Bronze');
    expect(unit.querySelector('h3')!.textContent).not.toContain('certified');
    expect(unit.querySelector('p')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('ZEDMSME000001 · UDYAM-UP-16-0001476 · East, Delhi · Micro');
    const links = [...unit.querySelectorAll<HTMLAnchorElement>('a')].map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links).toEqual([['MSME profile', '/staff/msme-profile/ZEDMSME000001'], ['Assessment details', '/staff/assessment/da-details/ZEDMSME000001/Bronze']]);
    // Newest first.
    expect(el.querySelector('.tl-item .tl-label')!.textContent).toContain('Application Received');
  });

  it('filters the events by who did them, and keeps the last searches in this browser', async () => {
    await search('ZEDMSME000001');
    http.expectOne('/api/staff/history/ZEDMSME000001').flush([
      row({ Description: 'Registered on portal' }),
      row({ CreatedDate: '2024-02-01T10:00:00', CertificationType: 'Bronze', StatusType: 'DocVerifiAllot' }),
      row({ CreatedDate: '2024-02-02T10:00:00', CertificationType: 'Bronze', StatusType: 'NcRaised' }),
      row({ CreatedDate: '2024-02-03T10:00:00', CertificationType: 'Bronze', StatusType: 'Completed' }),
    ]);
    await settle();
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush(null, { status: 404, statusText: 'Not Found' });
    await settle();
    // No profile: the header shows the ZED ID.
    expect(el.querySelector('[data-unit] h3')!.textContent).toContain('ZEDMSME000001');
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.cf-chip')];
    // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the chips add up; the untagged line has the "Other" chip.
    expect(chips.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['All 4', 'MSME 1', 'Agency 1', 'Assessor 1', 'ZED 0', 'Other 1']);
    chips[5].click();
    await settle();
    expect(el.querySelectorAll('.tl-item').length).toBe(1);
    expect(el.querySelector('.tl-item')!.hasAttribute('data-actor')).toBe(false);
    chips[3].click();
    await settle();
    expect([...el.querySelectorAll('.tl-item')].map((i) => i.getAttribute('data-actor'))).toEqual(['Assessor']);
    // The "Assessment Completed" line is not tagged.
    chips[0].click();
    await settle();
    expect(el.querySelectorAll('.tl-item .tl-actor').length).toBe(3);

    await search('ZEDMSME000002');
    http.expectOne('/api/staff/history/ZEDMSME000002').flush([]);
    await settle();
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)).toEqual(['ZEDMSME000002', 'ZEDMSME000001']);
    const recent = [...el.querySelectorAll<HTMLButtonElement>('.hs-pill')];
    expect(recent.map((b) => b.textContent!.trim())).toEqual(['ZEDMSME000001']);
    recent[0].click();
    await settle();
    http.expectOne('/api/staff/history/ZEDMSME000001').flush([]);
    await settle();
  });

  // 2026-11-18: "Recent:" only when a recent ZED ID other than the one shown is there.
  it('hides "Recent:" when the only recent ZED ID is the one shown', async () => {
    await search('ZEDMSME000003');
    http.expectOne('/api/staff/history/ZEDMSME000003').flush([]);
    await settle();
    expect(el.querySelector('.hs-recent')).toBeNull();
  });

  it('exports the events through the staff export', async () => {
    await search('ZEDMSME000001');
    http.expectOne('/api/staff/history/ZEDMSME000001').flush([row({ CertificationType: 'Bronze', StatusType: 'GetCertified', Description: 'Certificate generated' })]);
    await settle();
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush(null, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(el.querySelector('[data-unit] h3')!.textContent).toContain('Bronze certified');
    [...el.querySelectorAll<HTMLButtonElement>('[data-unit] button')].find((b) => b.textContent!.trim() === 'Export')!.click();
    await settle();
    const req = http.expectOne('/api/staff/export/xlsx');
    expect(req.request.body.fileName).toBe('zed-id-history-ZEDMSME000001');
    expect(req.request.body.sheets[0].rows[0].slice(1, 4)).toEqual(['ZED', 'Certified', 'Certificate generated']);
    req.flush(new Blob(['x']));
    await settle();
  });

  it('says so when there is no history', async () => {
    await search('ZEDMSME999999');
    http.expectOne('/api/staff/history/ZEDMSME999999').flush([]);
    await settle();
    expect(el.textContent).toContain('No certification history found for this unit.');
  });
});
