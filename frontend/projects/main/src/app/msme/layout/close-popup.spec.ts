import { closeTopPopup } from './msme-layout';

/** 2026-11-20 (applicant UI pass): Escape closes the newest open pop-up through its close button. */
describe('closeTopPopup', () => {
  it('clicks the close button of the last open pop-up, and reports when there is none', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="modal d-block" id="first"><div class="modal-header"><button class="btn-close" id="c1"></button></div></div>
      <div class="modal d-block" id="second"><div class="modal-header"><button aria-label="Close" id="c2"></button></div></div>`;
    document.body.appendChild(root);
    const clicked: string[] = [];
    root.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => clicked.push(b.id)));

    expect(closeTopPopup(root)).toBe(true);
    expect(clicked).toEqual(['c2']);

    const empty = document.createElement('div');
    document.body.appendChild(empty);
    expect(closeTopPopup(empty)).toBe(false);
    root.remove();
    empty.remove();
  });
});
