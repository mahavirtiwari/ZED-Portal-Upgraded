import { jpegPdf } from './export';

describe('jpegPdf', () => {
  const dec = new TextDecoder('latin1');

  it('writes a one-page PDF that shows the JPEG at A4 landscape width, with a correct cross-reference table', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const pdf = dec.decode(jpegPdf(jpeg, 2000, 1000));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 842 421]');
    expect(pdf).toContain('/Width 2000 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 9');
    expect(pdf).toContain('q 842 0 0 421 0 0 cm /Im0 Do Q');
    // Every xref entry points at its object.
    const xref = pdf.slice(pdf.indexOf('xref\n'));
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.map((o, i) => pdf.slice(o, o + `${i + 1} 0 obj`.length))).toEqual(['1 0 obj', '2 0 obj', '3 0 obj', '4 0 obj', '5 0 obj']);
    expect(Number(pdf.slice(pdf.indexOf('startxref\n') + 10).split('\n')[0])).toBe(pdf.indexOf('xref\n'));
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
