import { basicAttention, basicMissing, basicRaised } from './da-details.overview';

describe('basic information counts (2026-11-21)', () => {
  const details = (photos: Record<string, unknown>[], products: Record<string, unknown>[] = []) =>
    ({ photos, products, ncRounds: [] }) as unknown as Parameters<typeof basicRaised>[0];

  it('counts a missing selfie or site exterior photo as needing attention, not accepted', () => {
    const d = details([{ PhotoType: 'SiteExteriorPhotos', IsVerified: 'Yes' }]);
    expect(basicRaised(d)).toBe(0);
    expect(basicMissing(d)).toEqual({ selfie: true, siteExterior: false, count: 1 });
    expect(basicAttention(d)).toBe(1);
  });

  it('adds the items raised as NC to the missing ones', () => {
    const d = details([{ PhotoType: 'Selfie' }, { PhotoType: 'SiteExteriorPhotos', IsVerified: 'No' }], [{ IsVerified: 'No' }]);
    expect(basicMissing(d).count).toBe(0);
    expect(basicAttention(d)).toBe(2);
    expect(basicAttention(details([]))).toBe(2);
    expect(basicAttention(null)).toBe(0);
  });
});
