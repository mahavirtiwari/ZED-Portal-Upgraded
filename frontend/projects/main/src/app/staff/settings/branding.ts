import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { BrandingService, ThemeColours } from '../../branding';
import { PageHead } from '../../msme/shared/page-head';
import { ConfirmService } from '../confirm-dialog';
import { ToastService } from '../toast';
import { TextPipe, t } from '../../content/page-text';

export interface BrandingLogo {
  slot: string;
  label: string;
  hint: string;
  url: string | null;
}

export interface BrandingTarget {
  key: string;
  name: string;
  isApp: boolean;
  theme: string;
  logos: BrandingLogo[];
}

export interface BrandingTheme {
  key: string;
  name: string;
  dark: string;
  mid: string;
  accent: string;
}

/** Today's file of each spot (shown while no logo is saved). */
const TODAY: Record<string, string> = {
  'header-left': 'Images/header/ministry.png',
  'header-right': 'Images/header/zed-logo.png?ui=1',
  'login-left': 'Images/header/ministry.png',
  'login-right': 'Images/header/zed-logo.png?ui=1',
  footer: 'Images/footer/footer-icon.png',
  email: 'Images/header/zed-logo.png?ui=1',
  favicon: 'favicon.png',
};

/**
 * Admin → Settings → Branding (2026-11-15, design approved; main portal only): the logos of each portal and app and its
 * colour theme. A logo is used as soon as it is uploaded; Reset goes back to today's. "Preview" shows a theme on this
 * page before it is saved.
 */
@Component({
  selector: 'zed-branding',
  imports: [PageHead, TextPipe],
  template: `
    <zed-page-head [title]="'Branding' | t: 'staff.branding.title'" [crumbs]="crumbs()" />
    <p class="page-sub br-sub">{{ "Logos and colours of each portal and app. A spot without a saved logo shows today's." | t: 'staff.branding.sub' }}</p>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    @if (current(); as t) {
      <div class="zed-card br-card">
        <div class="br-tabs" role="tablist" [attr.aria-label]="'Portal or app' | t: 'staff.branding.tabs.aria'">
          @for (x of targets(); track x.key) {
            <button type="button" role="tab" class="br-tab" [class.active]="x.key === t.key" [attr.aria-selected]="x.key === t.key" (click)="choose(x.key)">{{ x.name }}</button>
          }
        </div>

        <h6 class="br-title">{{ 'Logos' | t: 'staff.branding.logos.title' }}</h6>
        <div class="br-logos">
          @for (l of t.logos; track l.slot) {
            <div class="br-logo" [attr.data-slot]="l.slot">
              <strong>{{ l.label }}</strong>
              <small class="muted">{{ l.hint }}</small>
              <div class="br-box" [class.br-app]="t.isApp">
                @if (l.url || today(l.slot)) {
                  <img [src]="l.url ?? today(l.slot)" [alt]="l.label" />
                } @else {
                  <span class="muted">{{ "Today's app logo" | t: 'staff.branding.logo.todayApp' }}</span>
                }
              </div>
              <div class="br-actions">
                <label class="btn btn-outline-primary btn-sm br-upload">
                  {{ 'Upload PNG / JPG' | t: 'staff.branding.logo.uploadButton' }}
                  <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" [attr.aria-label]="'Upload {logo}' | t: 'staff.branding.logo.uploadAria' : { logo: l.label }" (change)="upload(t, l, $event)" />
                </label>
                @if (l.url) {
                  <button type="button" class="btn btn-link btn-sm text-danger" (click)="reset(t, l)">{{ 'Reset' | t: 'staff.branding.logo.resetButton' }}</button>
                } @else {
                  <span class="muted br-today">{{ "Today's" | t: 'staff.branding.logo.today' }}</span>
                }
              </div>
            </div>
          }
        </div>
        @if (t.isApp) {
          <p class="muted br-note">{{ "The logo on the app's sign-in and home screens, from the app's next start. The app icon and the splash screen change only with a new app build." | t: 'staff.branding.logos.appNote' }}</p>
        }

        <h6 class="br-title">{{ 'Colour theme' | t: 'staff.branding.theme.title' }}</h6>
        <div class="br-themes" role="radiogroup" [attr.aria-label]="'Colour theme' | t: 'staff.branding.theme.title'">
          @for (th of themes(); track th.key) {
            <button type="button" role="radio" class="br-theme" [class.on]="chosen() === th.key" [attr.aria-checked]="chosen() === th.key" (click)="chosen.set(th.key)">
              <span class="br-sw"><i [style.background]="th.dark"></i><i [style.background]="th.mid"></i><i [style.background]="th.accent"></i></span>
              {{ themeName(th) }}@if (th.key === t.theme) {&ngsp;<span class="br-current">{{ '(current)' | t: 'staff.branding.theme.current' }}</span>}
            </button>
          }
        </div>
        <p class="muted br-note">
          @if (t.isApp) {
            {{ 'Recolours the menu bar, buttons, table headings, pop-up title bars and links of the app (after its update that reads the colours).' | t: 'staff.branding.theme.appNote' }}
          } @else {
            {{ 'Recolours the menu bar, buttons, table headings, pop-up title bars and links of this portal.' | t: 'staff.branding.theme.portalNote' }}
          }
        </p>
        <div class="br-foot">
          @if (!t.isApp) {
            <button type="button" class="btn btn-default" (click)="preview()">{{ previewing() ? ('End preview' | t: 'staff.branding.theme.endPreviewButton') : ('Preview on this page' | t: 'staff.branding.theme.previewButton') }}</button>
          }
          <button type="button" class="btn btn-primary" [disabled]="busy() || chosen() === t.theme" (click)="saveTheme(t)">{{ 'Save theme' | t: 'staff.branding.theme.saveButton' }}</button>
        </div>
      </div>
    }
    @if (busy()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .br-sub { margin: -8px 0 14px; color: #5f6f70; }
    .br-card { padding: 16px; }
    .br-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
    .br-tab { border: 1px solid #d9eef0; background: #d9eef0; color: #174a4e; border-radius: 6px; padding: 6px 14px; font-weight: 600; font-size: 13.5px; }
    .br-tab.active { background: #23656b; border-color: #23656b; color: #fff; }
    .br-title { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #2f7c83; margin: 16px 0 8px; }
    .br-logos { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
    .br-logo { border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
    .br-logo strong { font-size: 13.5px; color: #23474a; }
    .br-logo small { font-size: 12px; }
    .br-box { height: 70px; border: 1px dashed #9cc9cd; border-radius: 8px; background: #f6f9f9; display: flex; align-items: center; justify-content: center; margin: 4px 0; padding: 6px; }
    .br-box img { max-height: 100%; max-width: 100%; object-fit: contain; }
    .br-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .br-upload { position: relative; overflow: hidden; margin: 0; }
    .br-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .br-today { font-size: 12px; }
    .br-themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .br-theme { border: 1px solid #dfe9ea; border-radius: 8px; padding: 8px; background: #fff; font-size: 13px; color: #23474a; text-align: center; }
    .br-theme.on { border: 2px solid #23656b; padding: 7px; font-weight: 600; }
    .br-sw { display: flex; height: 26px; border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
    .br-sw i { flex: 1; }
    .br-current { color: #2f7c83; font-weight: 600; white-space: nowrap; }
    .br-note { font-size: 12.5px; margin: 8px 0 0; }
    .br-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class BrandingPage implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  /** 2026-11-19 (admin audit): saved messages as a toast at the bottom, beside Save theme (the alert at the top was out of view). */
  private readonly toast = inject(ToastService);
  private readonly brand = inject(BrandingService);
  private static readonly url = '/api/staff/settings/branding';
  protected readonly crumbs = computed(() => [
    { label: t('staff.branding.crumb.settings', 'All settings'), link: '/staff/administration' },
    { label: t('staff.branding.crumb.page', 'Branding') },
  ]);
  protected readonly targets = signal<BrandingTarget[]>([]);
  protected readonly themes = signal<BrandingTheme[]>([]);
  protected readonly selected = signal('main');
  protected readonly current = computed(() => this.targets().find((t) => t.key === this.selected()) ?? null);
  protected readonly chosen = signal('teal');
  protected readonly previewing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** The page's own theme before a preview. */
  private readonly own = this.brand.theme();

  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
    if (this.previewing()) this.brand.apply(this.own);
  }

  /** A theme's name; "(today)" of older servers is left out: the saved theme of the portal or app shown is marked "(current)". */
  protected themeName(th: BrandingTheme): string {
    return th.name.replace(/\s*\(today\)\s*$/i, '');
  }

  protected today(slot: string): string | null {
    return TODAY[slot] ?? null;
  }

  protected choose(key: string): void {
    this.endPreview();
    this.selected.set(key);
    this.chosen.set(this.current()?.theme ?? 'teal');
  }

  protected preview(): void {
    if (this.previewing()) {
      this.endPreview();
      return;
    }
    const th = this.themes().find((x) => x.key === this.chosen());
    if (!th) return;
    this.brand.apply({ key: th.key, dark: th.dark, mid: th.mid, accent: th.accent } satisfies ThemeColours);
    this.previewing.set(true);
  }

  private endPreview(): void {
    if (!this.previewing()) return;
    this.brand.apply(this.own);
    this.previewing.set(false);
  }

  protected async upload(t: BrandingTarget, l: BrandingLogo, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file, file.name);
    await this.run(() => firstValueFrom(this.http.post<MessageResponse>(`${BrandingPage.url}/${t.key}/logos/${l.slot}`, form)));
  }

  protected async reset(target: BrandingTarget, l: BrandingLogo): Promise<void> {
    if (!(await this.confirms.ask({
      title: t('staff.branding.confirm.resetTitle', 'Reset the Logo?'),
      message: t('staff.branding.confirm.resetMessage', '"{logo}" ({target}) uses today\'s logo again.', { logo: l.label, target: target.name }),
      confirmLabel: t('staff.branding.confirm.resetButton', 'Reset'), danger: true,
    }))) return;
    await this.run(() => firstValueFrom(this.http.delete<MessageResponse>(`${BrandingPage.url}/${target.key}/logos/${l.slot}`)));
  }

  protected async saveTheme(t: BrandingTarget): Promise<void> {
    this.endPreview();
    await this.run(() => firstValueFrom(this.http.put<MessageResponse>(`${BrandingPage.url}/${t.key}/theme`, { theme: this.chosen() })));
    if (t.key === 'main') await this.brand.load();
  }

  private async run(change: () => Promise<MessageResponse>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.toast.success((await change()).message);
      await this.load(false);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    try {
      const v = await firstValueFrom(this.http.get<{ targets: BrandingTarget[]; themes: BrandingTheme[] }>(BrandingPage.url));
      this.targets.set(v.targets);
      this.themes.set(v.themes);
      this.chosen.set(this.current()?.theme ?? 'teal');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
