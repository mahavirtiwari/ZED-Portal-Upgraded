import { BUILT_IN_TEXTS } from '../src/content/builtInTexts';
import { parseSteps } from '../src/screens/DashboardScreen';

describe('dashboard certification steps', () => {
  it('reads the label and value of each step from the built-in list', () => {
    const steps = parseSteps(BUILT_IN_TEXTS['app.msme.dashboard.certificationSteps'] ?? '');
    expect(steps).toHaveLength(5);
    expect(steps[0]).toEqual({ label: 'Basic Information & Document Upload', value: 'Provide Processes & Systems information' });
    expect(steps[2]?.label).toBe('Remote/Onsite Assessment');
    expect(steps[4]?.value).toContain('My Incentives');
  });

  it('keeps a step without a bold label, and returns nothing for text without a list', () => {
    expect(parseSteps('<ol><li>Only text</li></ol>')).toEqual([{ label: '', value: 'Only text' }]);
    expect(parseSteps('<p>No list here</p>')).toEqual([]);
  });
});
