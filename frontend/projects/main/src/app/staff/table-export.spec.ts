import { toCsv } from './table-export';

describe('toCsv (2026-11-17 staff Export)', () => {
  it('quotes commas, quotes and new lines, keeps numbers and makes formula text inert', () => {
    const csv = toCsv({ name: 'x', columns: ['Unit', 'Amount', 'Note'], rows: [['Acme, Pune', 5000.5, 'say "hi"'], ['=1+1', null, 'a\nb']] });
    expect(csv.split('\r\n')).toEqual(['Unit,Amount,Note', '"Acme, Pune",5000.5,"say ""hi"""', "'=1+1,,\"a\nb\""]);
  });
});
