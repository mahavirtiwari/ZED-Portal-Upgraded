import { Component, inject, input } from '@angular/core';
import { TextPipe } from '../../content/page-text';
import { inr } from '../schemes/schemes.api';
import { FormAnswers, FormField, FormItem, FormSection, IncentiveSchemesApi, filesOf } from './incentive-schemes.api';

/**
 * The answers of a scheme application, read only (the summary before submission and the submitted application): each section
 * with its items (an "Add more" item headed by its pick), the fields' values, documents as links, and the answers the assessor
 * found not valid marked with the remark.
 */
@Component({
  selector: 'zed-scheme-answers',
  imports: [TextPipe],
  template: `
    @for (s of sections(); track s.key) {
      <h4 class="sa-sec">{{ s.title }}</h4>
      @for (item of items(s); track $index; let i = $index) {
        @if (s.repeating) { <p class="sa-item">{{ i + 1 }}. {{ item.pickName || item.pick || ('Item' | t: 'msme.incentiveScheme.answers.item') }}</p> }
        <table class="table table-bordered sa-table">
          <tbody>
            @for (f of s.fields; track f.key) {
              @let r = remark(s.key, i, f.key);
              <tr [class.sa-flag]="r !== null">
                <td>{{ f.label }}</td>
                <td>
                  @if (f.type === 'document' || f.type === 'photo') {
                    <span class="sa-files">
                      @for (n of files(item, f); track n) { <a [href]="url(n)" target="_blank" rel="noopener">{{ 'View' | t: 'msme.incentiveScheme.answers.view' }} {{ $index + 1 }}</a> }
                      @empty { <span>—</span> }
                    </span>
                  } @else {
                    <b>{{ show(item, f) }}</b>
                  }
                  @if (r !== null) { <small class="sa-remark">{{ 'Not valid' | t: 'msme.incentiveScheme.field.notValid' }}@if (r) { : {{ r }} }</small> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      } @empty {
        <p class="sa-none">{{ 'Nothing added.' | t: 'msme.incentiveScheme.answers.none' }}</p>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .sa-sec { margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #24666b; }
    .sa-item { margin: 0 0 6px; font-weight: 700; color: #17373b; }
    .sa-table { margin-bottom: 18px; font-size: 14px; table-layout: fixed; }
    .sa-table td { overflow-wrap: anywhere; }
    .sa-table td:first-child { width: 45%; color: #5f6f70; }
    .sa-flag td { background: #fffaf0; }
    .sa-files { display: inline-flex; flex-wrap: wrap; gap: 8px; }
    .sa-files a { padding: 2px 12px; border: 1px solid #24666b; border-radius: 6px; font-size: 12.5px; font-weight: 700; color: #24666b; text-decoration: none; }
    .sa-remark { display: block; margin-top: 4px; color: #8a5a00; }
    .sa-none { color: #6f8487; }
  `,
})
export class SchemeAnswersComponent {
  private readonly api = inject(IncentiveSchemesApi);

  readonly code = input.required<string>();
  readonly sections = input.required<FormSection[]>();
  readonly answers = input.required<FormAnswers>();
  /** The answers found not valid: path → remark. */
  readonly checks = input<{ path: string; remarks: string | null }[]>([]);

  protected items(s: FormSection): FormItem[] {
    return (this.answers().sections[s.key] ?? []).filter((i) => i.saved || !s.repeating);
  }

  protected files(item: FormItem, f: FormField): string[] {
    return filesOf(item.values[f.key]);
  }

  protected url(name: string): string {
    return this.api.fileUrl(this.code(), name);
  }

  protected show(item: FormItem, f: FormField): string {
    const v = item.values[f.key];
    if (v === null || v === undefined || v === '') return '—';
    if (f.type === 'amount') return `₹ ${inr(v)}`;
    if (f.type === 'multichoice') return filesOf(v).join(', ');
    if (f.type === 'date') {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
    }
    return v;
  }

  protected remark(section: string, item: number, field: string): string | null {
    const c = this.checks().find((x) => x.path === `${section}/${item}/${field}`);
    return c ? c.remarks ?? '' : null;
  }
}
