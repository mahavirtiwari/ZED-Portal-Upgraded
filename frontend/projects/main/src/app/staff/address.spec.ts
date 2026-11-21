import { cleanAddress, joinAddress } from './address';

describe('cleanAddress (UI audit W8)', () => {
  it('leaves out blank parts, dashes and labels without a value', () => {
    expect(cleanAddress('Flat/Door/Block No: 12, Name of Premises/Building: , Block:- , Road/Street/Lane: -, City: Kanpur, Pin:- 208001'))
      .toBe('Flat/Door/Block No: 12, City: Kanpur, Pin:- 208001');
    expect(cleanAddress('Plot 4,, Industrial Area , - ,KANPUR')).toBe('Plot 4, Industrial Area, KANPUR');
    expect(cleanAddress(null)).toBe('');
  });

  it('joins address fields, each cleaned, without empty ones', () => {
    expect(joinAddress('Plot 4, Block:- ,', '', 'KANPUR', null, '208001')).toBe('Plot 4, KANPUR, 208001');
  });
});
