import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ClientPager, PagedView, PagerComponent, ServerPager } from './pager';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: i % 2 ? 'odd' : 'even' }));

describe('pager', () => {
  it('ClientPager pages and searches in the browser, back to page 1 on a new list or search', () => {
    const p = new ClientPager<{ id: number; name: string }>();
    p.set(rows(25));
    expect(p.lastPage()).toBe(3);
    expect(p.page().map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    p.go('next');
    p.go('next');
    p.go('next');
    expect(p.pageNo()).toBe(3);
    expect(p.page().length).toBe(5);
    expect(p.serial(0)).toBe(21);
    p.go('prev');
    expect(p.pageNo()).toBe(2);
    p.setSearch('ODD');
    expect(p.pageNo()).toBe(1);
    expect(p.total()).toBe(12);
    p.setPageSize(20);
    expect(p.lastPage()).toBe(1);
    p.go('last');
    p.go(1);
    expect(p.pageNo()).toBe(1);
    // refresh keeps the page when it still exists
    p.setSearch('');
    p.setPageSize(10);
    p.goTo(3);
    p.refresh(rows(22));
    expect(p.pageNo()).toBe(3);
    p.refresh(rows(5));
    expect(p.pageNo()).toBe(1);
  });

  it('ServerPager asks for the page it moves to', () => {
    const loads: number[] = [];
    const p = new ServerPager(20, () => loads.push(p.pageNo()));
    p.total.set(45);
    expect(p.lastPage()).toBe(3);
    p.go('last');
    p.go('next');
    p.goTo(2);
    p.goTo(2);
    expect(loads).toEqual([3, 2]);
    p.setPageSize(50);
    expect(p.pageNo()).toBe(1);
    expect(loads).toEqual([3, 2, 1]);
  });

  it('PagedView pages a list the screen owns and starts again when it changes', () => {
    const list = signal(rows(35));
    const v = new PagedView(() => list());
    v.go('last');
    expect(v.pageNo()).toBe(4);
    expect(v.serial(0)).toBe(31);
    list.set(rows(12));
    expect(v.pageNo()).toBe(1);
    expect(v.lastPage()).toBe(2);
  });

  it('draws Show N Entries, the record count and First / Prev / page / Next / Last', async () => {
    @Component({ imports: [PagerComponent], template: `<zed-pager [pager]="view" [sizes]="[10, 20, 200]" />` })
    class Host {
      readonly list = signal(rows(31));
      readonly view = new PagedView(() => this.list());
    }
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const [sizes, pages] = Array.from(el.querySelectorAll('select'));
    expect(Array.from(sizes.options).map((o) => o.value)).toEqual(['10', '20', '200']);
    expect(Array.from(pages.options).map((o) => o.value)).toEqual(['1', '2', '3', '4']);
    expect(el.textContent).toContain('(31 records)');
    const button = (label: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === label)!;
    expect(button('Prev').disabled).toBe(true);
    button('Last').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.view.pageNo()).toBe(4);
    expect(button('Next').disabled).toBe(true);
    sizes.value = '20';
    sizes.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.view.pageNo()).toBe(1);
    expect(fixture.componentInstance.view.lastPage()).toBe(2);
  });
});
