import { Component, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DocumentsApi, Invoice, MyDocuments } from './documents.api';

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

  protected readonly guidelines = computed(() => this.docs()?.Guidelines ?? []);
  protected readonly invoices = computed(() => this.docs()?.Invoices ?? []);

  /** Pledge always; only the highest of Bronze/Silver/Gold; WASH and webinar when issued (as before). */
  protected readonly certificates = computed<CertificateItem[]>(() => {
    const c = this.docs()?.Certificates?.[0];
    const items: CertificateItem[] = [{ label: 'Pledge Certificate', url: c?.Pledge ?? null }];
    if (!c) return items;
    if (c.Gold) items.push({ label: 'Gold Certificate', url: c.Gold });
    else if (c.Silver) items.push({ label: 'Silver Certificate', url: c.Silver });
    else if (c.Bronze) items.push({ label: 'Bronze Certificate', url: c.Bronze });
    if (c.Wash) items.push({ label: 'WASH Certificate', url: c.Wash });
    if (c.Webinar) items.push({ label: 'Webinar Participation Certificate', url: c.Webinar });
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
