import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaymentGatewayInfo, PaymentGatewayPage } from './payment-gateway';

describe('PaymentGatewayPage', () => {
  const url = '/api/staff/settings/payment-gateway';
  let fixture: ComponentFixture<PaymentGatewayPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const info = (over: Partial<PaymentGatewayInfo['gateway']> = {}, invoices: Partial<PaymentGatewayInfo['invoices']> = {}): PaymentGatewayInfo => ({
    gateway: {
      inUse: 'file', problem: null, saved: null,
      file: { configured: true, merchantId: '111', mode: 'live', mobileConfigured: true },
      returnBase: 'https://zedv3.qci.org.in', testAllowed: false, ...over,
    },
    invoices: { enabled: false, erpReady: false, examples: ['ZEDM/2627/1', 'ZEDS/2627/1'], ...invoices },
    paymentsOn: true,
  });

  async function create(data: PaymentGatewayInfo) {
    await TestBed.configureTestingModule({
      imports: [PaymentGatewayPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(PaymentGatewayPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(data);
    await settle();
  }

  const input = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement;
  const type = async (id: string, value: string) => {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
    await settle();
  };
  const forms = () => [...el.querySelectorAll('form')] as HTMLFormElement[];

  afterEach(() => http.verify());

  it('shows the server file in use, no test gateway on the live portal and invoices off', async () => {
    await create(info());
    expect(el.querySelector('[data-testid=gateway-in-use]')!.textContent).toContain('server settings file');
    expect(el.textContent).toContain('merchant 111, live gateway');
    expect((el.querySelector('input[name=mode][value=test]') as HTMLInputElement).disabled).toBe(true);
    expect(el.textContent).toContain('The test gateway cannot be used on the live portal.');
    expect(el.querySelector('[data-testid=invoices-state]')!.textContent!.trim()).toBe('Off');
    expect(el.textContent).toContain('ZEDM/2627/1 (Manufacturing), ZEDS/2627/1 (Services)');
    expect(el.textContent).toContain('Not set up (needed before switching on)');
    // No saved account: nothing to go back from.
    expect([...el.querySelectorAll('button')].some((b) => b.textContent!.includes('Use server file again'))).toBe(false);
  });

  it('saves a new account and leaves blank keys out', async () => {
    await create(info());
    await type('pg-merchant', '998877');
    await type('pg-access', 'AVNEW00AA11BB22CC');
    await type('pg-key', '0123456789ABCDEF0123456789ABCDEF');
    await type('pg-rec', '0123456789ABCDEF0123456789ABCDEF');
    forms()[1].dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
    expect(put.request.body).toEqual({
      mode: 'live', merchantId: '998877', accessCode: 'AVNEW00AA11BB22CC',
      workingKey: '0123456789ABCDEF0123456789ABCDEF', reconciliationKey: '0123456789ABCDEF0123456789ABCDEF',
      mobileAccessCode: null, mobileWorkingKey: null,
    });
    put.flush({ message: 'Payment gateway saved. Payments use this account within half a minute.' });
    await settle();
    http.expectOne(url).flush(info({
      inUse: 'page',
      saved: { merchantId: '998877', accessCode: 'AVNEW00AA11BB22CC', mode: 'live', workingKeySet: true, reconciliationKeySet: true, mobileAccessCode: null, mobileWorkingKeySet: false },
    }));
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Payment gateway saved.');
    expect(el.querySelector('[data-testid=gateway-in-use]')!.textContent).toContain('the account saved here');
    // The keys are never shown again: the boxes are empty and say a key is saved.
    expect(input('pg-key').value).toBe('');
    expect(input('pg-key').placeholder).toContain('Saved (hidden)');
  });

  const savedAccount = { merchantId: '998877', accessCode: 'AVNEW00AA11BB22CC', mode: 'live' as const, workingKeySet: true, reconciliationKeySet: true, mobileAccessCode: null, mobileWorkingKeySet: false };

  it('switches invoices off', async () => {
    await create(info({}, { enabled: true, erpReady: true }));
    const save = () => forms()[2].querySelector('button[type=submit]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    ([...el.querySelectorAll('input[name=invoices]')][1] as HTMLInputElement).click();
    await settle();
    expect(save().disabled).toBe(false);
    forms()[2].dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/invoices`);
    expect(put.request.body).toEqual({ enabled: false });
    put.flush({ message: 'Invoices are off.' });
    await settle();
    http.expectOne(url).flush(info({}, { enabled: false, erpReady: true }));
    await settle();
    expect(el.querySelector('[data-testid=invoices-state]')!.textContent!.trim()).toBe('Off');
  });

  it('goes back to the server file after confirming', async () => {
    await create(info({ inUse: 'page', saved: savedAccount }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Use server file again')) as HTMLButtonElement;
    button.click();
    await settle();
    http.expectOne((r) => r.method === 'DELETE' && r.url === url).flush({ message: "Payments use the server file's account again within half a minute." });
    await settle();
    http.expectOne(url).flush(info());
    await settle();
    expect(el.querySelector('[data-testid=gateway-in-use]')!.textContent).toContain('server settings file');
  });

  it('switches online payments off', async () => {
    await create(info());
    expect(el.querySelector('[data-testid=payments-state]')!.textContent!.trim()).toBe('On');
    ([...el.querySelectorAll('input[name=payments]')][1] as HTMLInputElement).click();
    await settle();
    forms()[0].dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/payments`);
    expect(put.request.body).toEqual({ enabled: false });
    put.flush({ message: 'Online payments are off.' });
    await settle();
    http.expectOne(url).flush({ ...info(), paymentsOn: false });
    await settle();
    expect(el.querySelector('[data-testid=payments-state]')!.textContent!.trim()).toBe('Off');
  });
});
