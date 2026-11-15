import { mayAssess, scopeChips } from './assessor-scope';
import { typeOfTicks } from './assessor-form';
import { levelFlowsFor } from '../settings/certification-levels';

describe('assessor levels and modes (2026-11-14)', () => {
  it('offers an assessor only for the levels and modes it is ticked for', () => {
    const a = { assessments: [{ level: 'Bronze', modes: ['Desktop'] }, { level: 'Silver', modes: ['Desktop', 'Onsite'] }] };
    expect(mayAssess(a, 'bronze', 'Desktop')).toBe(true);
    expect(mayAssess(a, 'Bronze', 'Onsite')).toBe(false);
    expect(mayAssess(a, 'Gold', 'Desktop')).toBe(false);
    // No ticks in the answer (surveillance): not limited.
    expect(mayAssess({}, 'Gold', 'Onsite')).toBe(true);
    expect(scopeChips([{ level: 'ZEDX', modes: ['Desktop', 'Onsite'] }])).toEqual(['ZED-X: Desktop, Onsite']);
  });

  it('keeps the old type in step with the ticks', () => {
    expect(typeOfTicks({ Bronze: ['Desktop'] })).toBe('BronzeAssessor');
    expect(typeOfTicks({ Bronze: ['Desktop'], Gold: ['Onsite'] })).toBe('Assessor');
    expect(typeOfTicks({ Bronze: [] })).toBe('');
  });

  it('lets every level choose every flow the server runs (2026-11-15)', () => {
    expect(levelFlowsFor('Bronze', ['Desktop', 'DesktopOnsite'])).toEqual(['Desktop', 'DesktopOnsite']);
    expect(levelFlowsFor('Gold', ['Desktop', 'DesktopOnsite'])).toEqual(['Desktop', 'DesktopOnsite']);
    expect(levelFlowsFor('PLATINUM', ['Desktop', 'DesktopOnsite'])).toEqual(['Desktop', 'DesktopOnsite']);
  });
});
