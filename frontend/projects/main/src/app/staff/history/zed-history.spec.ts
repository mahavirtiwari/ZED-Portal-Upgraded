import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HistoryRow, ZedHistoryPage, buildTimeline } from './zed-history';

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
    expect(el.querySelector('.history-summary')!.textContent).toContain('ZEDMSME000001');
    expect(el.querySelectorAll('.tl-item').length).toBe(2);
    expect(el.textContent).toContain('Application Received');
  });

  it('says so when there is no history', async () => {
    await search('ZEDMSME999999');
    http.expectOne('/api/staff/history/ZEDMSME999999').flush([]);
    await settle();
    expect(el.textContent).toContain('No certification history found for this unit.');
  });
});
