import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SchemesListPage } from './schemes-list';

describe('SchemesListPage', () => {
  let fixture: ComponentFixture<SchemesListPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/schemes';
  const list = (active = false) => ({
    schemes: [{
      code: 'TU_DIRECT', name: 'Technology Upgradation (direct)', active, orderNo: 1, cardTitle: 'Technology Upgradation',
      activation: { mode: 'Levels', levels: ['Bronze', 'Silver'] },
      grading: { mode: 'Size', rows: [{ key: 'Micro', sharePercent: 80, maxAmount: 300000 }] }, flow: 'Desktop',
    }],
    templates: ['FA', 'TU'],
    levels: [{ code: 'Bronze', name: 'Bronze' }, { code: 'Silver', name: 'Silver' }, { code: 'ZEDX', name: 'ZED-X' }],
    sizes: ['Micro', 'Small', 'Medium'],
  });

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
  const type = (id: string, value: string) => {
    const input = el.querySelector(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SchemesListPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(SchemesListPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(list());
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the schemes with when they open, the grading and the flow', () => {
    const row = el.querySelector('tr[data-code="TU_DIRECT"]') as HTMLElement;
    expect(row.textContent).toContain('Technology Upgradation (direct)');
    expect(row.textContent).toContain('Bronze, Silver');
    expect(row.textContent).toContain('By enterprise size');
    expect(row.textContent).toContain('Micro: 80% up to ₹3,00,000');
    expect(row.textContent).toContain('Desktop');
    expect(row.classList).toContain('is-off');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/TU_DIRECT');
  });

  it('switches a scheme on', async () => {
    (el.querySelector('tr[data-code="TU_DIRECT"] input[role="switch"]') as HTMLInputElement).click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === `${url}/TU_DIRECT/active`);
    expect(post.request.body).toEqual({ active: true });
    post.flush({ message: 'Scheme switched on. Eligible units see its card.' });
    await settle();
    http.expectOne(url).flush(list(true));
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('switched on');
    expect(el.querySelector('tr[data-code="TU_DIRECT"]')!.classList).not.toContain('is-off');
  });

  it('creates a scheme from a template and opens it', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button('New scheme').click();
    await settle();
    type('#sl-name', 'State FA 2027');
    await settle();
    expect((el.querySelector('#sl-code') as HTMLInputElement).value).toBe('STATE_FA_2027');
    const radios = [...el.querySelectorAll('.modal input[type="radio"]')] as HTMLInputElement[];
    expect(radios.length).toBe(3);
    radios[1].click();
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === url);
    expect(post.request.body).toEqual({ template: 'TU', code: 'STATE_FA_2027', name: 'State FA 2027' });
    post.flush({ message: 'Scheme added.' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['STATE_FA_2027'], expect.anything());
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('shows the server refusal in the pop-up', async () => {
    button('New scheme').click();
    await settle();
    type('#sl-name', 'Dup');
    type('#sl-code', 'TU_DIRECT');
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    http.expectOne((r) => r.method === 'POST' && r.url === url).flush({ title: 'The code TU_DIRECT is already used.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('already used');
  });
});
