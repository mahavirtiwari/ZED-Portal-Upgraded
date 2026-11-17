import { AfterViewInit, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';

/** The Bhashini website translation plugin, as on zed.msme.gov.in (js/bhashini.js there). */
export const BHASHINI_PLUGIN_SRC = 'https://translation-plugin.bhashini.co.in/v3/website_translation_utility.js';

interface BhashiniWindow extends Window {
  /** The plugin's container, kept across sign-outs (the plugin looks it up once, when its script runs). */
  __zedBhashiniHost?: HTMLElement;
}

/**
 * 2026-11-17 (the user: "Implement Bhashini plugin as per ZED website"): the language menu of the applicant's header.
 * The plugin (Government of India's Bhashini translation) builds its menu inside <code>.bhashini-plugin-container</code>
 * when its script runs, and translates the page in place. The script is added once per page load; the container it
 * filled is kept and moved back into the header when the header is drawn again (after signing out and in), since the
 * plugin does not look for a new one.
 */
@Component({
  selector: 'zed-bhashini-menu',
  host: { class: 'bh' },
  template: `<span #slot class="bh-slot"></span>`,
  styles: `
    :host { display: inline-flex; align-items: center; min-width: 40px; min-height: 40px; }
    .bh-slot { display: inline-flex; align-items: center; }
  `,
})
export class BhashiniMenu implements AfterViewInit, OnDestroy {
  private readonly slot = viewChild.required<ElementRef<HTMLElement>>('slot');
  private readonly doc = inject(ElementRef<HTMLElement>).nativeElement.ownerDocument as Document;

  ngAfterViewInit(): void {
    const win = this.doc.defaultView as BhashiniWindow | null;
    if (!win) return;
    if (win.__zedBhashiniHost) {
      this.slot().nativeElement.appendChild(win.__zedBhashiniHost);
      return;
    }
    const host = this.doc.createElement('div');
    host.className = 'bhashini-plugin-container';
    this.slot().nativeElement.appendChild(host);
    win.__zedBhashiniHost = host;

    const script = this.doc.createElement('script');
    script.src = BHASHINI_PLUGIN_SRC;
    script.async = true;
    // White on the menu strip, as on the ZED website.
    script.setAttribute('language-icon-color', '#ffffff');
    script.setAttribute('data-zed-bhashini', '');
    this.doc.body.appendChild(script);
  }

  ngOnDestroy(): void {
    // Keep the plugin's menu for the next header (it is not built again).
    const host = (this.doc.defaultView as BhashiniWindow | null)?.__zedBhashiniHost;
    host?.remove();
  }
}
