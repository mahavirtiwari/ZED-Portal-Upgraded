import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { MsmePledgePage, PledgeCertificate, StaffPledgePage } from './pledge-certificate';

const certificate: PledgeCertificate = {
  zedId: 'ZEDMSME000001',
  name: 'Shree Ganesh Precision Engineering Works',
  certificateNo: 'ZED_01012026_1',
  dateOfPledge: 'January 1, 2026',
  address: 'Plot 4, KANPUR, UTTAR PRADESH-208001',
  udyamNo: 'UDYAM-UP-29-0003915',
  qrImage: 'data:image/png;base64,AAAA',
  fileName: 'Pledge_Certificate_ZEDMSME000001.pdf',
  fields: [
    { name: 'Name', left: 25, top: 50, width: 57, height: 4, fontSize: 2.3, color: '#7B5613', bold: true, align: 'box-bottom', lines: ['Shree Ganesh Precision', 'Engineering Works'] },
    { name: 'RegistrationNumber', left: 53.8, top: 67.9, width: null, height: null, fontSize: 1.7, color: '#504F4F', bold: false, align: 'center', lines: null },
    { name: 'QrCode', left: 47.7, top: 80.3, width: 12, height: 8.5, fontSize: 0, color: '#000000', bold: false, align: 'image', lines: null },
  ],
};

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('Pledge certificate pages', () => {
  it('shows the MSME its certificate as the PDF draws it, with DOWNLOAD PDF', async () => {
    await TestBed.configureTestingModule({ imports: [MsmePledgePage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(MsmePledgePage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    http.expectOne('/api/msme/pledge-certificate').flush(certificate);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;

    expect([...el.querySelectorAll('.pledge-box span')].map((s) => s.textContent)).toEqual(['Shree Ganesh Precision', 'Engineering Works']);
    expect(el.querySelector('.pledge-text')!.textContent!.trim()).toBe('UDYAM-UP-29-0003915');
    expect((el.querySelector('.pledge-qr') as HTMLImageElement).getAttribute('src')).toBe('data:image/png;base64,AAAA');
    const download = [...el.querySelectorAll('a')].find((a) => a.textContent!.trim() === 'DOWNLOAD PDF')!;
    expect(download.getAttribute('href')).toBe('/api/msme/pledge-certificate/pdf');
    expect(download.getAttribute('download')).toBe('Pledge_Certificate_ZEDMSME000001.pdf');
    http.verify();
  });

  it('shows staff the certificate of the ZED ID in the address', async () => {
    await TestBed.configureTestingModule({
      imports: [StaffPledgePage],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ zedId: 'ZEDMSME000001' }) } } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(StaffPledgePage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    http.expectOne('/api/staff/certification-documents/ZEDMSME000001/pledge-certificate/view').flush(certificate);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const download = [...el.querySelectorAll('a')].find((a) => a.textContent!.trim() === 'DOWNLOAD PDF')!;
    expect(download.getAttribute('href')).toBe('/api/staff/certification-documents/ZEDMSME000001/pledge-certificate');
    http.verify();
  });
});
