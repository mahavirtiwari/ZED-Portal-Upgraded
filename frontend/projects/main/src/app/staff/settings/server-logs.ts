import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PortalSwitchComponent } from '../admin-portal';
import { indianTime } from '../utc-time';
import { TextPipe, t } from '../../content/page-text';

/** One log entry (Zed.Core.Logging LogEntry; short JSON names). */
export interface ServerLogEntry {
  t: string;
  l: string;
  s: string;
  c: string;
  e: number;
  m: string;
  x?: string | null;
  r?: string | null;
  p?: string | null;
  u?: string | null;
}

interface ServerLogsResponse {
  source: string;
  sources: { name: string; days: string[] }[];
  entries: ServerLogEntry[];
  more: boolean;
  from: string;
  to: string;
  /** 2026-11-23: this portal's log folder on the server, and why it cannot be written (null when it can). */
  folder?: string | null;
  writeProblem?: string | null;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * 2026-11-21 (the user: "add logger"; often no access to the server): Admin → Server Logs. The portal's warnings and errors
 * (and the mobile API hosts' beside it) with the full error, the page or API address, the user and the reference an error
 * message shows (the trace id): filter by days, level and text, open an entry, download a day's file. Each portal keeps its
 * own log: the portal switch reads the others.
 */
@Component({
  selector: 'zed-staff-server-logs',
  imports: [FormsModule, PortalSwitchComponent, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Server Logs' | t: 'staff.serverLogs.title' }}</h3>
        <p class="page-sub">{{ "The portal's warnings and errors, with the full error, the address, the user and the reference shown in error messages. Kept for 30 days." | t: 'staff.serverLogs.sub' }}</p>
      </div>
    </div>
    <zed-portal-switch [reload]="false" (changed)="load()" />

    <div class="zed-card sl-filters">
      @if (sources().length > 1) {
        <label class="sl-field"><span>{{ 'Log' | t: 'staff.serverLogs.filter.source' }}</span>
          <select class="form-select" [ngModel]="source()" (ngModelChange)="source.set($event); load()">
            @for (s of sources(); track s.name) { <option [ngValue]="s.name">{{ sourceName(s.name) }}</option> }
          </select>
        </label>
      }
      <label class="sl-field"><span>{{ 'From' | t: 'staff.serverLogs.filter.from' }}</span>
        <input type="date" class="form-control" [max]="to()" [ngModel]="from()" (ngModelChange)="from.set($event)" />
      </label>
      <label class="sl-field"><span>{{ 'To' | t: 'staff.serverLogs.filter.to' }}</span>
        <input type="date" class="form-control" [min]="from()" [max]="today" [ngModel]="to()" (ngModelChange)="to.set($event)" />
      </label>
      <label class="sl-field"><span>{{ 'Level' | t: 'staff.serverLogs.filter.level' }}</span>
        <select class="form-select" [ngModel]="level()" (ngModelChange)="level.set($event)">
          <option value="Warning">{{ 'Warnings and errors' | t: 'staff.serverLogs.level.warning' }}</option>
          <option value="Error">{{ 'Errors only' | t: 'staff.serverLogs.level.error' }}</option>
          <option value="Critical">{{ 'Critical only' | t: 'staff.serverLogs.level.critical' }}</option>
        </select>
      </label>
      <label class="sl-field sl-search"><span>{{ 'Search' | t: 'staff.serverLogs.filter.search' }}</span>
        <input type="search" class="form-control" maxlength="200" [placeholder]="'Text, address, user or reference' | t: 'staff.serverLogs.filter.searchPlaceholder'"
               [ngModel]="q()" (ngModelChange)="q.set($event)" (keydown.enter)="load()" />
      </label>
      <div class="sl-actions">
        <button type="button" class="btn btn-primary" (click)="load()" [disabled]="busy()">{{ 'Show' | t: 'staff.serverLogs.show' }}</button>
        <button type="button" class="btn btn-outline-primary" (click)="download()" [disabled]="busy()">{{ 'Download day' | t: 'staff.serverLogs.download' }}</button>
      </div>
    </div>

    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (writeProblem()) {
      <div class="alert alert-danger" role="alert" data-write-problem>
        <strong>{{ 'This portal cannot write its log, so nothing new is recorded.' | t: 'staff.serverLogs.writeProblem.title' }}</strong>
        <span class="d-block">{{ 'Folder {folder}: {problem}' | t: 'staff.serverLogs.writeProblem.detail' : { folder: folder(), problem: writeProblem() } }}</span>
        <span class="d-block">{{ "On the server, give the portal's app pool Modify on this folder (the deploy script does it for each portal's logs folder)." | t: 'staff.serverLogs.writeProblem.fix' }}</span>
      </div>
    }

    <div class="sl-counts" role="status">
      <span class="chip chip-error">{{ '{n} errors' | t: 'staff.serverLogs.count.errors' : { n: errors() } }}</span>
      <span class="chip chip-warn">{{ '{n} warnings' | t: 'staff.serverLogs.count.warnings' : { n: warnings() } }}</span>
      @if (folder() && !writeProblem()) { <span class="muted sl-folder" data-log-folder>{{ 'Recording to {folder}' | t: 'staff.serverLogs.folder' : { folder: folder() } }}</span> }
      @if (more()) { <span class="muted">{{ 'Showing the newest {n}: narrow the days or the search to see older ones.' | t: 'staff.serverLogs.more' : { n: entries().length } }}</span> }
    </div>

    <div class="zed-card list-card">
      <div class="table-responsive">
        <table class="table table-zed sl-table">
          <thead>
            <tr>
              <th class="sl-time">{{ 'Time (IST)' | t: 'staff.serverLogs.column.time' }}</th>
              <th>{{ 'Level' | t: 'staff.serverLogs.column.level' }}</th>
              <th>{{ 'Message' | t: 'staff.serverLogs.column.message' }}</th>
              <th>{{ 'Address' | t: 'staff.serverLogs.column.path' }}</th>
              <th>{{ 'User' | t: 'staff.serverLogs.column.user' }}</th>
              <th class="text-end">{{ 'Action' | t: 'staff.serverLogs.column.action' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (e of entries(); track $index) {
              <tr [class.is-error]="isError(e)">
                <td class="sl-time">{{ time(e.t) }}</td>
                <td><span class="chip" [class.chip-error]="isError(e)" [class.chip-warn]="!isError(e)">{{ levelName(e.l) }}</span></td>
                <td class="sl-msg">
                  <span class="sl-text">{{ e.m }}</span>
                  @if (e.x) { <small class="muted d-block sl-ex">{{ firstLine(e.x) }}</small> }
                  <small class="muted d-block">{{ shortCategory(e.c) }}</small>
                </td>
                <td class="sl-path">{{ e.p || '–' }}</td>
                <td class="sl-user">{{ e.u || '–' }}</td>
                <td class="text-end"><button type="button" class="btn btn-sm btn-outline-primary" (click)="open.set(e)">{{ 'View' | t: 'staff.serverLogs.view' }}</button></td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="no-data">{{ busy() ? ('Loading…' | t: 'staff.serverLogs.loading') : ('Nothing logged for these filters.' | t: 'staff.serverLogs.empty') }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    @if (open(); as e) {
      <div class="modal-backdrop-zed" (click)="open.set(null)"></div>
      <div class="modal-zed sl-modal" role="dialog" aria-modal="true" aria-labelledby="slTitle">
        <div class="modal-head">
          <h4 id="slTitle">{{ levelName(e.l) }} · {{ time(e.t) }}</h4>
          <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.serverLogs.close'" (click)="open.set(null)"></button>
        </div>
        <div class="modal-body">
          <dl class="sl-dl">
            <div><dt>{{ 'Message' | t: 'staff.serverLogs.column.message' }}</dt><dd class="sl-text">{{ e.m }}</dd></div>
            <div><dt>{{ 'Address' | t: 'staff.serverLogs.column.path' }}</dt><dd>{{ e.p || '–' }}</dd></div>
            <div><dt>{{ 'User' | t: 'staff.serverLogs.column.user' }}</dt><dd>{{ e.u || '–' }}</dd></div>
            <div><dt>{{ 'Reference' | t: 'staff.serverLogs.reference' }}</dt><dd class="sl-mono">{{ e.r || '–' }}</dd></div>
            <div><dt>{{ 'Source' | t: 'staff.serverLogs.category' }}</dt><dd class="sl-mono">{{ e.c }}@if (e.e) { ({{ e.e }}) }</dd></div>
            <div><dt>{{ 'Log' | t: 'staff.serverLogs.filter.source' }}</dt><dd>{{ sourceName(e.s) }}</dd></div>
          </dl>
          @if (e.x) {
            <div class="sl-ex-head">
              <strong>{{ 'Error details' | t: 'staff.serverLogs.details' }}</strong>
              <button type="button" class="btn btn-sm btn-outline-primary" (click)="copy(e)">{{ copied() ? ('Copied' | t: 'staff.serverLogs.copied') : ('Copy' | t: 'staff.serverLogs.copy') }}</button>
            </div>
            <pre class="sl-pre">{{ e.x }}</pre>
          }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-primary" (click)="open.set(null)">{{ 'Close' | t: 'staff.serverLogs.close' }}</button>
        </div>
      </div>
    }
  `,
  styles: `
    .sl-filters { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
    .sl-field { display: flex; flex-direction: column; gap: 4px; min-width: 150px; flex: 0 1 170px; font-size: 12px; font-weight: 700; color: #5f6f70; }
    .sl-search { flex: 1 1 240px; }
    .sl-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
    .sl-folder { overflow-wrap: anywhere; font-size: 12px; }
    .sl-counts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 10px; font-size: 13px; }
    .chip { display: inline-block; border-radius: 10px; padding: 2px 9px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .chip-error { background: #fde3e1; color: #8f1f15; }
    .chip-warn { background: #fff1d6; color: #7a4700; }
    .sl-table td { vertical-align: top; }
    .sl-time { white-space: nowrap; }
    .sl-msg { min-width: 260px; max-width: 520px; }
    .sl-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .sl-ex { overflow-wrap: anywhere; color: #8f1f15 !important; }
    .sl-path, .sl-user { overflow-wrap: anywhere; min-width: 120px; font-size: 13px; }
    tr.is-error td:first-child { box-shadow: inset 3px 0 0 #b0362b; }
    .modal-backdrop-zed { position: fixed; inset: 0; background: rgba(0, 0, 0, .4); z-index: 1050; }
    .modal-zed { position: fixed; z-index: 1060; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(920px, calc(100vw - 24px));
      max-height: calc(100vh - 24px); display: flex; flex-direction: column; background: #fff; border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
    .modal-head, .modal-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #e6eded; }
    .modal-foot { border-top: 1px solid #e6eded; border-bottom: 0; justify-content: flex-end; flex-wrap: wrap; }
    .modal-head h4 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
    .modal-body { padding: 14px 16px; overflow: auto; }
    .sl-dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 16px; margin: 0 0 12px; }
    .sl-dl dt { font-size: 12px; color: #5f6f70; }
    .sl-dl dd { margin: 0; overflow-wrap: anywhere; }
    .sl-mono { font-family: Consolas, monospace; font-size: 12px; }
    .sl-ex-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0 6px; }
    .sl-pre { background: #f6f8f8; border: 1px solid #e6eded; border-radius: 6px; padding: 10px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto; margin: 0; }
    @media (max-width: 575.98px) {
      .sl-field { flex: 1 1 100%; }
      .sl-actions { margin-left: 0; width: 100%; }
      .sl-actions .btn { flex: 1 1 auto; }
    }
  `,
})
export class ServerLogsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/server-logs';

  protected readonly today = isoDay(new Date());
  protected readonly from = signal(this.today);
  protected readonly to = signal(this.today);
  protected readonly level = signal('Warning');
  protected readonly q = signal('');
  protected readonly source = signal<string | null>(null);
  protected readonly sources = signal<{ name: string; days: string[] }[]>([]);
  protected readonly entries = signal<ServerLogEntry[]>([]);
  protected readonly more = signal(false);
  protected readonly folder = signal<string | null>(null);
  protected readonly writeProblem = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly open = signal<ServerLogEntry | null>(null);
  protected readonly copied = signal(false);
  protected readonly errors = computed(() => this.entries().filter((e) => this.isError(e)).length);
  protected readonly warnings = computed(() => this.entries().length - this.errors());

  constructor() {
    void this.load();
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.open.set(null);
  }

  protected isError(e: ServerLogEntry): boolean {
    return e.l === 'Error' || e.l === 'Critical';
  }

  protected levelName(level: string): string {
    switch (level) {
      case 'Critical': return t('staff.serverLogs.levelName.critical', 'Critical');
      case 'Error': return t('staff.serverLogs.levelName.error', 'Error');
      default: return t('staff.serverLogs.levelName.warning', 'Warning');
    }
  }

  protected sourceName(name: string): string {
    switch (name) {
      case 'main': return t('staff.serverLogs.source.main', 'ZED Certification portal');
      case 'consultancy': return t('staff.serverLogs.source.consultancy', 'Consultancy portal');
      case 'surveillance': return t('staff.serverLogs.source.surveillance', 'Surveillance portal');
      default: return name.startsWith('mobile-') ? t('staff.serverLogs.source.mobile', 'Mobile apps server ({system})', { system: name.slice(7) }) : name;
    }
  }

  protected time(utc: string): string {
    return indianTime(utc, 'dd-MM-yyyy HH:mm:ss');
  }

  protected firstLine(text: string): string {
    const line = text.split('\n')[0];
    return line.length > 220 ? line.slice(0, 220) + '…' : line;
  }

  protected shortCategory(category: string): string {
    const parts = category.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : category;
  }

  protected async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      let params = new HttpParams().set('from', this.from()).set('to', this.to()).set('level', this.level());
      if (this.q().trim()) params = params.set('q', this.q().trim());
      if (this.source()) params = params.set('source', this.source()!);
      const r = await firstValueFrom(this.http.get<ServerLogsResponse>(ServerLogsPage.url, { params }));
      this.sources.set(r.sources);
      this.source.set(r.source);
      this.entries.set(r.entries);
      this.more.set(r.more);
      this.folder.set(r.folder ?? null);
      this.writeProblem.set(r.writeProblem ?? null);
    } catch (err) {
      this.entries.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** The "To" day's file of the log shown (as it is: one JSON entry per line). */
  protected async download(): Promise<void> {
    this.error.set('');
    try {
      let params = new HttpParams().set('day', this.to());
      if (this.source()) params = params.set('source', this.source()!);
      const blob = await firstValueFrom(this.http.get(`${ServerLogsPage.url}/download`, { params, responseType: 'blob' }));
      const a = document.createElement('a');
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `${this.source() ?? 'main'}-zed-${this.to().replace(/-/g, '')}.jsonl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (err) {
      this.error.set((err as { status?: number })?.status === 404
        ? t('staff.serverLogs.noFile', 'Nothing was logged on that day.')
        : apiErrorMessage(err));
    }
  }

  protected async copy(e: ServerLogEntry): Promise<void> {
    try {
      await navigator.clipboard.writeText([e.t, e.l, e.c, e.p, e.u, e.r, e.m, e.x].filter(Boolean).join('\n'));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* the browser refused the clipboard */
    }
  }
}
