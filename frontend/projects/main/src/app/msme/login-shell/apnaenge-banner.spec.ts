import { mottoParts } from './apnaenge-banner';

describe('mottoParts (2026-11-17 Apnaenge ZED! banner, option B)', () => {
  it('turns the words before the dash into chips and keeps the rest', () => {
    expect(mottoParts('Zero Defect, Zero Effect — better quality, less waste, more business.'))
      .toEqual({ chips: ['Zero Defect', 'Zero Effect'], rest: 'better quality, less waste, more business.' });
    expect(mottoParts('<p>Zero Defect, Zero Effect: better quality</p>')).toEqual({ chips: ['Zero Defect', 'Zero Effect'], rest: 'better quality' });
  });

  it('shows a line without a dash whole, with no chips', () => {
    expect(mottoParts('Quality for every MSME')).toEqual({ chips: [], rest: 'Quality for every MSME' });
  });
});
