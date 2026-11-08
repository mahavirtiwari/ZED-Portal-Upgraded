import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ListFiltersBar } from '../../staff/dashboard/list-controls';
import { canonicalCertification, certificationKind, certificationLevel } from '../certification/certification.api';
import { isWebEntryLevel } from '../entry/entry.api';
import {
  PublicLevels, canonicalLevelCode, isLegacyLevel, isV4Level, levelCodes, levelMode, levelName, setAllLevels, splitCertification,
} from './levels';

/** api/public/levels/all with a level the Admin added (PLATINUM, desktop assessment, not enabled yet). */
const ALL = [
  { code: 'Bronze', name: 'Bronze', isEnabled: true, assessmentMode: 'Desktop', logoUrl: null, orderNo: 10 },
  { code: 'Silver', name: 'Silver', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 20 },
  { code: 'Gold', name: 'Gold', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 30 },
  { code: 'ZEDX', name: 'ZED-X', isEnabled: true, assessmentMode: 'Site', logoUrl: null, orderNo: 40 },
  { code: 'PLATINUM', name: 'Platinum', isEnabled: false, assessmentMode: 'Desktop', logoUrl: '/api/public/levels/PLATINUM/logo', orderNo: 50 },
] as const;

describe('levels (Administration → Certification Levels)', () => {
  afterEach(() => setAllLevels(null));

  it('keeps the built-in levels until the list arrives, and tells the legacy levels from the V4 ones', () => {
    expect(levelCodes()).toEqual(['Bronze', 'Silver', 'Gold', 'ZEDX']);
    expect(levelName('ZEDX')).toBe('ZED-X');
    expect(canonicalLevelCode('platinum')).toBeNull();
    expect([isLegacyLevel('gold'), isV4Level('Gold'), isV4Level('ZEDX'), isV4Level('PLATINUM'), isV4Level('../x')]).toEqual([true, false, true, true, false]);
  });

  it('loads every level once (api/public/levels/all), in the Admin\'s order, disabled ones too', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const levels = TestBed.inject(PublicLevels);
    const http = TestBed.inject(HttpTestingController);
    const done = levels.loadAll();
    void levels.loadAll();
    http.expectOne('/api/public/levels/all').flush([...ALL].reverse());
    await done;
    http.verify();
    expect(levelCodes()).toEqual(['Bronze', 'Silver', 'Gold', 'ZEDX', 'PLATINUM']);
    expect(levelCodes(true)).toEqual(['Bronze', 'Silver', 'Gold', 'ZEDX']);
    expect(levelName('PLATINUM')).toBe('Platinum');
    expect(levelName('platinum')).toBe('Platinum');
    expect(levelMode('PLATINUM')).toBe('Desktop');
    expect(canonicalLevelCode('platinum')).toBe('PLATINUM');
    expect(canonicalLevelCode('Diamond')).toBeNull();
  });

  it('reads a level from a certification type, its surveillance and the milestones', () => {
    setAllLevels([...ALL]);
    expect(splitCertification('platinumsurveillance')).toEqual({ level: 'PLATINUM', suffix: 'Surveillance' });
    expect(splitCertification('GoldMilestone2')).toEqual({ level: 'Gold', suffix: 'Milestone2' });
    expect(splitCertification('Diamond')).toBeNull();
    expect(canonicalCertification('platinum')).toBe('PLATINUM');
    expect(canonicalCertification('PlatinumSurveillance')).toBe('PLATINUMSurveillance');
    expect(canonicalCertification('PLATINUMMilestone1')).toBeNull();
    expect(certificationKind('PLATINUM')).toBe('silverGold');
    expect(certificationKind('PLATINUMSurveillance')).toBe('surveillance');
    expect(certificationLevel('PLATINUMSurveillance')).toBe('PLATINUM');
    // Entered on the web as ZED-X; not its surveillance.
    expect([isWebEntryLevel('PLATINUM'), isWebEntryLevel('ZEDX'), isWebEntryLevel('Gold'), isWebEntryLevel('PLATINUMSurveillance')]).toEqual([true, true, false, false]);
  });

  it('offers a level the Admin added in the staff list filters', async () => {
    setAllLevels([...ALL]);
    TestBed.configureTestingModule({ imports: [ListFiltersBar] });
    const fixture = TestBed.createComponent(ListFiltersBar);
    fixture.componentRef.setInput('filter', {});
    fixture.detectChanges();
    await fixture.whenStable();
    const options = [...(fixture.nativeElement as HTMLElement).querySelectorAll('#f-cert option')].map((o) => `${(o as HTMLOptionElement).value}:${o.textContent!.trim()}`);
    expect(options).toEqual([':Show All', 'Bronze:Bronze', 'Silver:Silver', 'Gold:Gold', 'ZEDX:ZED-X', 'PLATINUM:Platinum']);
  });
});
