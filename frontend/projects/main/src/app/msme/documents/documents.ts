import { Component, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DocumentsApi, Invoice, MyDocuments } from './documents.api';
import { levelName } from '../shared/levels';

interface CertificateItem {
  label: string;
  url: string | null;
}

/** My Documents: guidelines, certificates and invoices/receipts. Port of Views/Msme/MyDocuments.cshtml. */
@Component({
  selector: 'zed-msme-documents',
  templateUrl: './documents.html',
  styleUrl: './documents.scss',
})
export class DocumentsPage {
  private readonly api = inject(DocumentsApi);

  protected readonly loading = signal(true);
  protected readonly error = signal('');
  private readonly docs = signal<MyDocuments | null>(null);

  /** Only the guidelines that can be opened: a document whose file is not on the server (no path, no video) is left out. */
  protected readonly guidelines = computed(() => (this.docs()?.Guidelines ?? []).filter((g) => !!g.VideoUrl || !!g.DocumentPath));
  protected readonly invoices = computed(() => this.docs()?.Invoices ?? []);

  /** Pledge always; only the highest of Bronze/Silver/Gold; ZED-X. (MSME KAWACH's WASH and webinar certificates were removed.) */
  protected readonly certificates = computed<CertificateItem[]>(() => {
    const c = this.docs()?.Certificates?.[0];
    // V4: the pledge certificate is drawn when asked for, so it is always there (its page has DOWNLOAD PDF).
    const items: CertificateItem[] = [{ label: 'Pledge Certificate', url: '/msme/pledge-certificate' }];
    if (!c) return items;
    if (c.Gold) items.push({ label: 'Gold Certificate', url: c.Gold });
    else if (c.Silver) items.push({ label: 'Silver Certificate', url: c.Silver });
    else if (c.Bronze) items.push({ label: 'Bronze Certificate', url: c.Bronze });
    // ZED-X and the levels the Admin added (2026-11-08): a separate track each, besides the highest of Bronze/Silver/Gold.
    for (const [code, url] of Object.entries(c)) {
      if (url && typeof url === 'string' && !['Pledge', 'Bronze', 'Silver', 'Gold'].includes(code)) items.push({ label: `${levelName(code)} Certificate`, url });
    }
    return items;
  });

  constructor() {
    this.load();
  }

  protected invoiceLabel(inv: Invoice): string {
    const parts = [`${inv.ModuleName ?? ''} - ${inv.Certification ?? ''}`];
    if (inv.ModuleName === 'HANDHOLDING' && inv.MileStoneNo) parts.push(`milestone ${inv.MileStoneNo}`);
    if ((inv.ModuleName === 'ZED' || inv.ModuleName === 'SURVEILLANCE') && inv.SubModuleName) parts.push(inv.SubModuleName);
    if (inv.DocumentType) parts.push(inv.DocumentType);
    return parts.join(' ');
  }

  /** PDFs open in a new tab; other guideline files (docx, xlsx, ...) just download. */
  protected target(url: string): string | null {
    return /\.pdf$/i.test(url) || !url.startsWith('/') ? '_blank' : null;
  }

  private async load(): Promise<void> {
    try {
      this.docs.set(await firstValueFrom(this.api.get()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
