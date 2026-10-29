import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Levels whose basic information and documents are entered on the web (MsmeEntry.Levels on the server). Bronze, Silver
 * and Gold are entered in the MSME app.
 */
export const WEB_ENTRY_LEVELS: readonly string[] = ['ZEDX'];

export const isWebEntryLevel = (level: string | null | undefined): boolean => !!level && WEB_ENTRY_LEVELS.includes(level);

/** A field of the Admin's form (Admin → App Forms), as the app gets it (AppForms.ToAppJson). */
export interface FormField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  custom: boolean;
  section: string;
  order: number;
  help?: string;
  heading?: string;
  options?: string[];
  optionsSource?: string;
  separator?: string;
  maxItems?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  when?: { field: string; equals: string };
  columns?: FormField[];
}

export interface FormDefinition {
  form: string;
  name: string;
  version: string;
  sections: { key: string; label: string }[];
  fields: FormField[];
}

export interface EntryFile {
  id: string;
  url: string;
  isPdf: boolean;
}

export interface EntryProduct {
  productName: string | null;
  exported: string | null;
  productPhoto: EntryFile | null;
  productDescriptionPhoto: EntryFile | null;
}

export interface EntryRawMaterial {
  rawMaterialName: string | null;
  rawMaterialPercentage: string | null;
  countryName: string | null;
}

export interface EntryEvidence {
  id: number;
  code: string;
  name: string;
  help: string | null;
  /** Needed for the final submit. */
  required: boolean;
  uploaded: boolean;
  url: string | null;
}

export interface EntrySection {
  code: string;
  name: string;
  requirements: { code: string; name: string; evidences: EntryEvidence[] }[];
}

export interface EntryState {
  certification: string;
  paid: boolean;
  /** Paid and not yet final-submitted. */
  editable: boolean;
  submitted: boolean;
  certificationStatus: number | null;
  basicInfoSaved: boolean;
  form: FormDefinition;
  saved: {
    answers: Record<string, string | string[] | null>;
    products: EntryProduct[];
    rawMaterials: EntryRawMaterial[];
    siteExteriorPhotos: EntryFile[];
    /** The Admin's own fields; several choices as a JSON array text. */
    custom: Record<string, string | null>;
  };
  sections: EntrySection[];
}

export interface EntryMessage {
  message: string;
}

/** Client for api/msme/entry (Zed.Portal MsmeEntryController). */
@Injectable({ providedIn: 'root' })
export class EntryApi {
  private readonly http = inject(HttpClient);

  private url(level: string, path = ''): string {
    return `/api/msme/entry/${encodeURIComponent(level)}${path}`;
  }

  state(level: string): Observable<EntryState> {
    return this.http.get<EntryState>(this.url(level));
  }

  /** `body`: the `data` part (JSON) and the new photos under their upload names. */
  saveBasicInfo(level: string, body: FormData): Observable<EntryMessage> {
    return this.http.post<EntryMessage>(this.url(level, '/basic-info'), body);
  }

  uploadEvidence(level: string, evidenceId: number, files: File[]): Observable<EntryMessage> {
    const body = new FormData();
    for (const f of files) body.append('files', f, f.name);
    return this.http.post<EntryMessage>(this.url(level, `/evidences/${evidenceId}`), body);
  }

  finalSubmit(level: string): Observable<EntryMessage> {
    return this.http.post<EntryMessage>(this.url(level, '/final-submit'), {});
  }
}
