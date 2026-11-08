import { BUILT_IN_STATES, onStates, setStates, states } from './states';

describe('states', () => {
  afterEach(() => setStates(BUILT_IN_STATES));

  it('starts with the 36 states and union territories', () => {
    expect(states().length).toBe(36);
    expect(states().find((s) => s.code === '37')?.name).toBe('LADAKH');
  });

  it('keeps every page list in step with the masters, sorted by name', () => {
    const seen: string[][] = [];
    onStates((list) => seen.push(list.map((s) => s.name)));
    setStates([{ code: '99', name: 'NEW STATE' }, { code: '9', name: 'UTTAR PRADESH' }]);
    expect(seen.at(-1)).toEqual(['NEW STATE', 'UTTAR PRADESH']);
  });

  it('ignores an empty answer', () => {
    setStates([]);
    expect(states().length).toBe(36);
  });
});
