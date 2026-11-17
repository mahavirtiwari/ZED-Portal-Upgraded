import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DocumentsApi, Guideline, Invoice, MyDocuments } from './documents.api';
import { allLevels, levelLogo, levelName } from '../shared/levels';
import { PageHead } from '../shared/page-head';
import { reportRoute } from '../../report/report.api';

/** The colour of a card's top edge: the level's, teal for the pledge. */
type Tone = 'pledge' | 'bronze' | 'silver' | 'gold' | 'zedx' | 'teal';

interface CertificateItem {
  label: string;
  url: string | null;
  /** 2026-11-15: the level's assessment report page (View, a new tab), next to its certificate. */
  report?: boolean;
  /** The one-line description under the title. */
  detail: string;
  tone: Tone;
}

/** The filter chips (2026-11-17, the user's design): All / Certificates / Reports / Guidelines, and Invoices when there are any. */
type Filter = 'all' | 'cert' | 'report' | 'guide' | 'inv';

/**
 * My Documents: certificates and reports as cards, invoices/receipts and guidelines as lists. Port of
 * Views/Msme/MyDocuments.cshtml; 2026-11-17 (the user's design): search, filter chips and a locked card for the next level.
 */
@Component({
  selector: 'zed-msme-documents',
  imports: [RouterLink, PageHead],
  templateUrl: './documents.html',
  styleUrl: './documents.scss',
})
export class DocumentsPage {
  private readonly api = inject(DocumentsApi);

  protected readonly loading = signal(true);
  protected readonly error = signal('');
  private readonly docs = signal<MyDocuments | null>(null);
  protected readonly query = signal('');
  protected readonly filter = signal<Filter>('all');
  protected readonly levelLogo = levelLogo;

  /** Only the guidelines that can be opened: a document whose file is not on the server (no path, no video) is left out. */
  protected readonly guidelines = computed(() => (this.docs()?.Guidelines ?? []).filter((g) => !!g.VideoUrl || !!g.DocumentPath));
  protected readonly invoices = computed(() => this.docs()?.Invoices ?? []);

  /** Pledge always; only the highest of Bronze/Silver/Gold; ZED-X. (MSME KAWACH's WASH and webinar certificates were removed.) */
  protected readonly certificates = computed<CertificateItem[]>(() => {
    const c = this.docs()?.Certificates?.[0];
    // V4: the pledge certificate is drawn when asked for, so it is always there (its page has DOWNLOAD PDF).
    const items: CertificateItem[] = [{ label: 'Pledge Certificate', url: '/msme/pledge-certificate', detail: 'Certificate of the ZED Pledge', tone: 'pledge' }];
    if (!c) return items;
    const add = (code: string, label: string, url: string) => {
      const tone = this.tone(code);
      items.push({ label: `${label} Certificate`, url, detail: 'ZED certification certificate', tone });
      items.push({ label: `${label} Assessment Report`, url: reportRoute({ kind: 'assessment', level: code }), report: true, detail: 'Assessment report, a page with Download PDF', tone });
    };
    if (c.Gold) add('Gold', 'Gold', c.Gold);
    else if (c.Silver) add('Silver', 'Silver', c.Silver);
    else if (c.Bronze) add('Bronze', 'Bronze', c.Bronze);
    // ZED-X and the levels the Admin added (2026-11-08): a separate track each, besides the highest of Bronze/Silver/Gold.
    for (const [code, url] of Object.entries(c)) {
      if (url && typeof url === 'string' && !['Pledge', 'Bronze', 'Silver', 'Gold'].includes(code)) add(code, levelName(code), url);
    }
    return items;
  });

  /** The next level the unit can apply for (Bronze → Silver → Gold → ZED-X), for the locked card; null at the top. */
  protected readonly nextLevel = computed<{ code: string; after: string } | null>(() => {
    const d = this.docs();
    if (!d) return null;
    const c = d.Certificates?.[0];
    const held = c?.Gold ? 'Gold' : c?.Silver ? 'Silver' : c?.Bronze ? 'Bronze' : null;
    const code = held === null ? 'Bronze' : held === 'Bronze' ? 'Silver' : held === 'Silver' ? 'Gold' : c?.['ZEDX'] ? null : 'ZEDX';
    if (!code || allLevels().find((l) => l.code === code)?.isEnabled === false) return null;
    return { code, after: levelName(code) };
  });

  private readonly q = computed(() => this.query().trim().toLowerCase());
  private matches(...texts: (string | null | undefined)[]): boolean {
    const q = this.q();
    return !q || texts.some((t) => (t ?? '').toLowerCase().includes(q));
  }
  private shows(f: Filter): boolean {
    return this.filter() === 'all' || this.filter() === f;
  }

  protected readonly counts = computed(() => {
    const certs = this.certificates();
    const n = { cert: certs.filter((c) => !c.report).length, report: certs.filter((c) => c.report).length, guide: this.guidelines().length, inv: this.invoices().length };
    return { ...n, all: n.cert + n.report + n.guide + n.inv };
  });

  /** The chips: All always, the others when they have a document. */
  protected readonly chips = computed(() => {
    const n = this.counts();
    const list: { id: Filter; label: string; count: number }[] = [
      { id: 'all', label: 'All', count: n.all },
      { id: 'cert', label: 'Certificates', count: n.cert },
      { id: 'report', label: 'Reports', count: n.report },
      { id: 'guide', label: 'Guidelines', count: n.guide },
      { id: 'inv', label: 'Invoices', count: n.inv },
    ];
    return list.filter((c) => c.id === 'all' || c.count > 0);
  });

  protected readonly shownCards = computed(() =>
    this.certificates().filter((c) => this.shows(c.report ? 'report' : 'cert') && this.matches(c.label, c.detail)));
  protected readonly showLocked = computed(() => !!this.nextLevel() && this.shows('cert') && !this.q());
  protected readonly shownInvoices = computed(() =>
    this.shows('inv') ? this.invoices().filter((i) => this.matches(this.invoiceLabel(i), this.invoiceDetail(i))) : []);
  protected readonly shownGuidelines = computed(() =>
    this.shows('guide') ? this.guidelines().filter((g: Guideline) => this.matches(g.DocumentName, g.Description)) : []);
  protected readonly nothingShown = computed(() =>
    !this.shownCards().length && !this.showLocked() && !this.shownInvoices().length && !this.shownGuidelines().length);

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

  protected invoiceDetail(inv: Invoice): string {
    return inv.TadaInvoiceNo ? `${inv.DocumentType || 'Document'} no. ${inv.TadaInvoiceNo}` : '';
  }

  /** A guideline file's type badge: its extension (PDF, DOCX, ...), else FILE. */
  protected fileType(url: string | null | undefined): string {
    const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(url ?? '');
    return m ? m[1].toUpperCase() : 'FILE';
  }

  /** PDFs open in a new tab; other guideline files (docx, xlsx, ...) just download. */
  protected target(url: string): string | null {
    return /\.pdf$/i.test(url) || !url.startsWith('/') ? '_blank' : null;
  }

  private tone(code: string): Tone {
    const c = code.toLowerCase();
    return c === 'bronze' || c === 'silver' || c === 'gold' || c === 'zedx' ? c : 'teal';
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
