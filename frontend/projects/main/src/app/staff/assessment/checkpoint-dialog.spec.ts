import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Checkpoint, CheckpointDialog, CheckpointSaveRequest, CheckpointStage } from './checkpoint-dialog';

@Component({
  imports: [CheckpointDialog],
  template: `<zed-checkpoint-dialog title="1.2" [checkpoints]="checkpoints()" [stage]="stage()" (saved)="saved.set($event)" (closed)="closed.set(true)" />`,
})
class Host {
  readonly checkpoints = signal<Checkpoint[]>([]);
  readonly stage = signal<CheckpointStage>('Desktop');
  readonly saved = signal<CheckpointSaveRequest | null>(null);
  readonly closed = signal(false);
}

const checkpoint = (over: Partial<Checkpoint> = {}): Checkpoint => ({
  id: 1, requirementId: 9, optionCode: '1', text: 'Written quality policy', actions: ['Write it', 'Display it'],
  evidences: [{ id: 5, name: 'Policy document', mandatory: true, uploaded: false, verified: null }, { id: 6, name: 'Photo', mandatory: false, uploaded: false, verified: null }],
  desktop: null, site: null, baseline: null, review1: null, review2: null, ...over,
});

describe('CheckpointDialog', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function start(stage: CheckpointStage, list: Checkpoint[]) {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.stage.set(stage);
    fixture.componentInstance.checkpoints.set(list);
    el = fixture.nativeElement;
    await settle();
  }

  const pick = (code: string, value: string) => el.querySelector<HTMLInputElement>(`section[data-checkpoint="${code}"] input[value=${value}]`)!.click();
  const submit = () => el.querySelector<HTMLInputElement>('input[value=SUBMIT]')!.click();
  const problem = () => el.querySelector('.alert-danger')?.textContent?.trim() ?? '';

  beforeEach(() => TestBed.configureTestingModule({ imports: [Host] }).compileComponents());

  it('needs every mandatory evidence for Yes, and shows optional ones as optional', async () => {
    await start('Desktop', [checkpoint()]);
    expect(el.textContent).toContain('Mandatory');
    expect(el.textContent).toContain('Optional');
    expect(el.textContent).toContain('not uploaded');
    pick('1', 'Yes');
    await settle();
    submit();
    await settle();
    expect(problem()).toContain('"Policy document" is not uploaded');
    expect(fixture.componentInstance.saved()).toBeNull();
  });

  it('offers the actions needed for No or Partial and shows the result', async () => {
    await start('Desktop', [checkpoint({ evidences: [] }), checkpoint({ id: 2, optionCode: '2', actions: [], evidences: [] })]);
    pick('1', 'Yes');
    pick('2', 'Partial');
    await settle();
    expect(el.querySelector('section[data-checkpoint="1"] input[type=checkbox]')).toBeNull();
    expect(el.querySelector('.cp-result')!.textContent).toContain('Not conforming');
    submit();
    await settle();
    // No actions defined by the Admin: what is needed must be written.
    expect(problem()).toContain('Checkpoint 2: please write what is needed.');
    const remark = el.querySelector<HTMLTextAreaElement>('section[data-checkpoint="2"] textarea')!;
    remark.value = 'Set yearly targets';
    remark.dispatchEvent(new Event('input'));
    await settle();
    submit();
    await settle();
    expect(fixture.componentInstance.saved()).toEqual({
      answers: [{ id: 1, answer: 'Yes', actions: [], remarks: null }, { id: 2, answer: 'Partial', actions: [], remarks: 'Set yearly targets' }],
      remarks: null,
    });
  });

  it('shows the earlier answers in the progress reviews and asks for the answer only', async () => {
    await start('Review2', [checkpoint({ baseline: { value: 'No', actions: ['Write it'], remarks: null }, review1: 'Partial' })]);
    expect(el.textContent).toContain('Progress Review 2');
    expect(el.textContent!.replace(/\s+/g, ' ')).toContain('Baseline: No');
    expect(el.textContent!.replace(/\s+/g, ' ')).toContain('Progress Review 1: Partial');
    pick('1', 'Partial');
    await settle();
    expect(el.querySelector('input[type=checkbox]')).toBeNull();
    expect(el.querySelector('.cp-result')).toBeNull();
    submit();
    await settle();
    expect(fixture.componentInstance.saved()!.answers).toEqual([{ id: 1, answer: 'Partial', actions: [], remarks: null }]);
  });

  it('starts from the answer given at its stage', async () => {
    await start('Site', [checkpoint({ evidences: [], desktop: { value: 'Yes', actions: [], remarks: null }, site: { value: 'No', actions: ['Display it'], remarks: 'Not on display' } })]);
    expect(el.textContent!.replace(/\s+/g, ' ')).toContain('Desktop assessor: Yes');
    expect(el.querySelector<HTMLInputElement>('input[value=No]')!.checked).toBe(true);
    expect(el.querySelector<HTMLInputElement>('input[type=checkbox]:checked')!.parentElement!.textContent).toContain('Display it');
    el.querySelector<HTMLInputElement>('input[value=CANCEL]')!.click();
    expect(fixture.componentInstance.closed()).toBe(true);
  });
});
