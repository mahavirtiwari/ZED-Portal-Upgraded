import { ParameterNav, parameterChip, parameterComplete, parameterProgress, parameterStatus, requirementStatus } from './parameter-status';

describe('parameter status', () => {
  it('gives a requirement its conformance, Partial while checkpoints are answered, else Pending', () => {
    expect(requirementStatus('Yes')).toBe('Yes');
    expect(requirementStatus(' no ')).toBe('No');
    expect(requirementStatus('Partially')).toBe('Partial');
    expect(requirementStatus(null, true)).toBe('Partial');
    expect(requirementStatus(undefined)).toBe('Pending');
  });

  it('derives a parameter status from its requirements', () => {
    expect(parameterStatus([])).toBe('Pending');
    expect(parameterStatus(['Pending', 'Pending'])).toBe('Pending');
    expect(parameterStatus(['Yes', 'No', 'Pending'])).toBe('No');
    expect(parameterStatus(['Yes', 'Yes'])).toBe('Yes');
    expect(parameterStatus(['Yes', 'Pending'])).toBe('Partial');
  });

  it('counts decided requirements and complete parameters', () => {
    expect(parameterProgress(['Yes', 'No', null, 'Partial'])).toEqual({ done: 2, total: 4, percent: 50 });
    expect(parameterComplete({ done: 2, total: 2, percent: 100 }, false)).toBe(true);
    expect(parameterComplete({ done: 1, total: 2, percent: 50 }, false)).toBe(false);
    expect(parameterComplete({ done: 0, total: 0, percent: 0 }, false)).toBe(false);
    expect(parameterComplete({ done: 0, total: 2, percent: 0 }, true)).toBe(true);
    expect(parameterChip('No', true)).toBe('Exempt');
  });

  it('selects the first parameter until one is picked', () => {
    const sections = [{ id: 'a', exempt: false }, { id: 'b', exempt: true }];
    const reqs: Record<string, string[]> = { a: ['Yes', 'No'], b: [] };
    const nav = new ParameterNav<{ id: string; exempt: boolean }, string>({
      sections: () => sections, id: (s) => s.id, requirements: (s) => reqs[s.id], conformance: (r) => r, exempted: (s) => s.exempt,
    });
    expect(nav.active()).toBe(sections[0]);
    nav.select(sections[1]);
    expect(nav.active()).toBe(sections[1]);
    expect(nav.chip(sections[0])).toBe('No');
    expect(nav.chip(sections[1])).toBe('Exempt');
    expect(nav.complete()).toBe(2);
  });
});
