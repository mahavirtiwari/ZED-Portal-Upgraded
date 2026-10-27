import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

export interface StaffDocument {
  id: number;
  documentName: string;
  description: string | null;
  downloadUrl: string | null;
  videoUrl: string | null;
  createdDate: string | null;
}

/**
 * Documents (new in V4): the documents and videos the Admin gave to this account type (Admin → Documents/Videos;
 * api/staff/documents). Before V4 the documents went to the MSMEs only.
 */
@Component({
  selector: 'zed-staff-role-documents',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Documents</h3>
        <p class="page-sub">Guidelines, documents and videos shared with you by the ZED team.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    <div class="zed-card">
      <input class="form-control mb-3" type="search" placeholder="Search documents..." aria-label="Search documents" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      @for (d of shown(); track d.id) {
        <div class="sd-item">
          <div class="sd-main">
            <strong>{{ d.documentName }}</strong> <span class="zed-chip">{{ d.videoUrl ? 'Video' : 'File' }}</span>
            @if (d.description) { <p class="muted mb-0">{{ d.description }}</p> }
            @if (d.createdDate) { <small class="muted">Added {{ d.createdDate | date: 'dd-MM-yyyy' }}</small> }
          </div>
          @if (d.videoUrl) {
            <a class="btn btn-sm btn-outline-primary" [href]="d.videoUrl" target="_blank" rel="noopener noreferrer">Watch</a>
          } @else if (d.downloadUrl) {
            <a class="btn btn-sm btn-outline-primary" [href]="d.downloadUrl" target="_blank" rel="noopener">Download</a>
          }
        </div>
      } @empty {
        @if (loaded()) { <div class="no-data">{{ documents().length ? 'Nothing matches the search.' : 'No documents have been shared with you yet.' }}</div> }
      }
    </div>
  `,
  styles: `
    .sd-item { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 0; border-top: 1px solid #eef3f3; }
    .sd-main { flex: 1; min-width: 220px; }
  `,
})
export class StaffRoleDocumentsPage {
  private readonly http = inject(HttpClient);

  protected readonly documents = signal<StaffDocument[]>([]);
  protected readonly search = signal('');
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.documents().filter((d) => !q || d.documentName.toLowerCase().includes(q) || (d.description ?? '').toLowerCase().includes(q));
  });
  protected readonly loaded = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.documents.set(await firstValueFrom(this.http.get<StaffDocument[]>('/api/staff/documents')));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loaded.set(true);
    }
  }
}
