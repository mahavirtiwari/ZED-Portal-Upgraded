import { HttpClient } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** One text (or the QR code) of the certificate, placed as the PDF places it (PledgeCertificateView.Field on the server). */
export interface PledgeField {
  name: string;
  /** % of the page width: the centre of a centred text, else the left edge. */
  left: number;
  /** % of the page height: the top of the text or box. */
  top: number;
  width: number | null;
  height: number | null;
  /** % of the page width. */
  fontSize: number;
  color: string;
  bold: boolean;
  align: 'center' | 'box-bottom' | 'image';
  /** A boxed text broken into lines where the PDF breaks it. */
  lines: string[] | null;
}

export interface PledgeCertificate {
  zedId: string;
  name: string;
  certificateNo: string;
  dateOfPledge: string;
  address: string;
  udyamNo: string;
  qrImage: string | null;
  fields: PledgeField[];
  fileName: string;
}

/**
 * The pledge certificate as a page (V4): the certificate picture with the unit's details on it, as the PDF draws them,
 * and DOWNLOAD PDF, which has the server draw the PDF and saves it on this computer. No file is kept on the server.
 */
@Component({
  selector: 'zed-pledge-certificate',
  template: `
    @let c = certificate();
    <div class="pledge-actions">
      <a class="btn btn-primary" [href]="pdfUrl()" [attr.download]="c.fileName">DOWNLOAD PDF</a>
      <a class="btn btn-default" [href]="pdfUrl() + (pdfUrl().includes('?') ? '&' : '?') + 'inline=true'" target="_blank" rel="noopener">OPEN PDF</a>
    </div>
    <div class="pledge-sheet" role="img" [attr.aria-label]="'ZED pledge certificate of ' + c.name + ', ' + c.zedId">
      @for (f of c.fields; track f.name) {
        @switch (f.align) {
          @case ('image') {
            @if (c.qrImage) {
              <img class="pledge-qr" [src]="c.qrImage" alt="" [style.left.%]="f.left" [style.top.%]="f.top" [style.width.%]="f.width" [style.height.%]="f.height" />
            }
          }
          @case ('box-bottom') {
            <div class="pledge-box" [style.left.%]="f.left" [style.top.%]="f.top" [style.width.%]="f.width" [style.height.%]="f.height"
                 [style.font-size]="f.fontSize + 'cqw'" [style.color]="f.color" [class.bold]="f.bold">
              @for (line of f.lines ?? []; track $index) { <span>{{ line }}</span> }
            </div>
          }
          @default {
            <div class="pledge-text" [style.left.%]="f.left" [style.top.%]="f.top" [style.font-size]="f.fontSize + 'cqw'" [style.color]="f.color" [class.bold]="f.bold">
              {{ textOf(c, f.name) }}
            </div>
          }
        }
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .pledge-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 16px; }
    /* The certificate picture (Pledge.jpg, A4 at 300 dpi) with the texts over it; sizes follow the sheet's width. */
    .pledge-sheet {
      position: relative; container-type: inline-size; width: 100%; max-width: 760px; margin: 0 auto;
      aspect-ratio: 2482 / 3508; background: #fff url('/Images/certificates-pledge.jpg') center / 100% 100% no-repeat;
      box-shadow: 0 4px 18px rgba(16, 61, 64, .15); font-family: Arial, Helvetica, sans-serif; line-height: 1.15;
    }
    .pledge-text { position: absolute; transform: translateX(-50%); white-space: nowrap; }
    .pledge-box { position: absolute; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; text-align: center; }
    .pledge-qr { position: absolute; image-rendering: pixelated; }
    .bold { font-weight: 700; }
    @media print {
      .pledge-actions { display: none; }
      .pledge-sheet { box-shadow: none; max-width: none; }
    }
  `,
})
export class PledgeCertificateCard {
  readonly certificate = input.required<PledgeCertificate>();
  /** Where the PDF is drawn (a download; "?inline=true" opens it in the browser). */
  readonly pdfUrl = input.required<string>();

  protected textOf(c: PledgeCertificate, field: string): string {
    switch (field) {
      case 'RegistrationNumber': return c.udyamNo;
      case 'DateOfPledge': return c.dateOfPledge;
      case 'CertificateNo': return c.certificateNo;
      case 'Name': return c.name;
      default: return '';
    }
  }
}

/** The signed-in MSME's pledge certificate (/msme/pledge-certificate). */
@Component({
  selector: 'zed-msme-pledge-certificate',
  imports: [PledgeCertificateCard, RouterLink],
  template: `
    <div class="container pledge-page">
      <div class="page-head">
        <div>
          <h3 class="registration-title">ZED Pledge Certificate</h3>
        </div>
        <a routerLink="/msme/dashboard" class="btn btn-default">BACK</a>
      </div>
      @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
      @if (certificate(); as c) { <zed-pledge-certificate [certificate]="c" pdfUrl="/api/msme/pledge-certificate/pdf" /> }
    </div>
  `,
  styles: `.pledge-page { padding: 24px 12px 48px; }`,
})
export class MsmePledgePage {
  protected readonly certificate = signal<PledgeCertificate | null>(null);
  protected readonly error = signal('');

  constructor() {
    firstValueFrom(inject(HttpClient).get<PledgeCertificate>('/api/msme/pledge-certificate'))
      .then((c) => this.certificate.set(c))
      .catch((err) => this.error.set(apiErrorMessage(err)));
  }
}

/** An MSME's pledge certificate for staff (/staff/pledge-certificate/:zedId), for those who may see its records. */
@Component({
  selector: 'zed-staff-pledge-certificate',
  imports: [PledgeCertificateCard],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">ZED Pledge Certificate</h3>
      </div>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (certificate(); as c) { <zed-pledge-certificate [certificate]="c" [pdfUrl]="pdfUrl" /> }
  `,
})
export class StaffPledgePage {
  protected readonly zedId = inject(ActivatedRoute).snapshot.paramMap.get('zedId') ?? '';
  protected readonly pdfUrl = `/api/staff/certification-documents/${encodeURIComponent(this.zedId)}/pledge-certificate`;
  protected readonly certificate = signal<PledgeCertificate | null>(null);
  protected readonly error = signal('');

  constructor() {
    firstValueFrom(inject(HttpClient).get<PledgeCertificate>(`${this.pdfUrl}/view`))
      .then((c) => this.certificate.set(c))
      .catch((err) => this.error.set(apiErrorMessage(err)));
  }
}
