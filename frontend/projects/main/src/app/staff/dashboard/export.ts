/**
 * Dashboard export (V4): the page as a JPEG image, or that image as a one-page PDF. The capture library is loaded only
 * when an export is asked for; the PDF is written here (a JPEG needs no other library: PDF shows it as is).
 */

/** Elements with this class (buttons, menus) are left out of the picture. */
export const NO_EXPORT = 'no-export';

/** The element as a JPEG data URL, at twice the screen resolution, on the page background. */
export async function captureJpeg(el: HTMLElement): Promise<string> {
  const { toJpeg } = await import('html-to-image');
  return toJpeg(el, {
    quality: 0.92,
    pixelRatio: 2,
    backgroundColor: '#f2f6f6',
    cacheBust: true,
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains(NO_EXPORT)),
  });
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/**
 * A one-page PDF showing the JPEG, the page as wide as A4 landscape (842 pt) and as tall as the picture needs, so the
 * whole dashboard stays on one page.
 */
export function jpegPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const enc = new TextEncoder();
  const pageW = 842;
  const pageH = Math.round((pageW * height) / width);
  const content = enc.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`);
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: Uint8Array | string) => {
    const bytes = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: (Uint8Array | string)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  object(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  object(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  object(4, [
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ]);
  object(5, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

function save(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves the element as `<name>.jpg` or `<name>.pdf`. */
export async function exportElement(el: HTMLElement, format: 'jpeg' | 'pdf', name: string): Promise<void> {
  const dataUrl = await captureJpeg(el);
  const jpeg = dataUrlBytes(dataUrl);
  if (format === 'jpeg') {
    save(`${name}.jpg`, new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    return;
  }
  const { width, height } = await imageSize(dataUrl);
  save(`${name}.pdf`, new Blob([jpegPdf(jpeg, width, height) as BlobPart], { type: 'application/pdf' }));
}
