import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { IncentiveSchemeHost } from './incentive-scheme-host';

let made = 0;

/** Stands in for the scheme page: counts how many pages are made. */
@Component({ selector: 'zed-msme-incentive-scheme', template: '' })
class PageStub {
  constructor() {
    made++;
  }
}

describe('IncentiveSchemeHost (2026-11-27)', () => {
  it('makes a fresh scheme page when the scheme code changes without a reload', () => {
    made = 0;
    const params = new BehaviorSubject(convertToParamMap({ code: 'TU_DIRECT' }));
    TestBed.configureTestingModule({ imports: [IncentiveSchemeHost], providers: [{ provide: ActivatedRoute, useValue: { paramMap: params } }] });
    TestBed.overrideComponent(IncentiveSchemeHost, { set: { imports: [PageStub] } });
    const fixture = TestBed.createComponent(IncentiveSchemeHost);
    fixture.detectChanges();
    expect(made).toBe(1);

    params.next(convertToParamMap({ code: 'FA' }));
    fixture.detectChanges();
    expect(made).toBe(2);

    // The same code again (e.g. a query change) keeps the page and what was typed in it.
    params.next(convertToParamMap({ code: 'FA' }));
    fixture.detectChanges();
    expect(made).toBe(2);
  });
});
