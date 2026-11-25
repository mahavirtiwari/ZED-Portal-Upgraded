import { MAX_PDF_BYTES, PDF_TOO_LARGE, storePdf } from '@zed/shared';

// 2026-11-25 (the user: "make it 5 mb"): the incentive scheme documents take PDFs up to 5 MB; every other upload keeps 2 MB.
describe('PDF size limit', () => {
  const ctx = (maxPdfMb?: number) => ({ store: {} as never, loginId: 'U', associatedId: null, coords: null, maxPdfMb });
  const MB = 1024 * 1024;

  it('keeps 2 MB when no limit is given', async () => {
    expect(MAX_PDF_BYTES).toBe(2 * MB);
    expect(await storePdf(ctx(), 'content://a.pdf', 3 * MB)).toEqual({ kind: 'error', message: PDF_TOO_LARGE, alert: true });
  });

  it('takes up to 5 MB for the scheme documents', async () => {
    expect(await storePdf(ctx(5), 'content://a.pdf', 6 * MB)).toEqual({ kind: 'error', message: 'File size cannot exceed 5 MB', alert: true });
    // 4 MB passes the size check (it then stops at the missing owner, before touching the phone).
    const fourMb = await storePdf(ctx(5), 'content://a.pdf', 4 * MB);
    expect(fourMb.kind === 'error' && fourMb.message).not.toBe('File size cannot exceed 5 MB');
  });
});
