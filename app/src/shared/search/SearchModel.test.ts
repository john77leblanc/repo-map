import { describe, expect, it } from 'vitest';
import { SearchModel, pinFirst, snippetOf, type SearchSection } from './SearchModel';

const sections: SearchSection[] = [
    { id: 'a', title: 'Pages', groups: [{ id: 'g', title: '', items: [
        { id: 'home', title: 'Home', names: ['home', 'Home'], desc: 'The landing page with offers.', paths: ['src/Home.tsx'] },
        { id: 'cart', title: 'Cart', names: ['cart', 'Cart', '/cart'], desc: 'Basket.', paths: ['src/cart/CartPage.tsx'] },
    ] }] },
    { id: 'b', title: 'Parts', groups: [{ id: 'h', title: 'Shared', items: [
        { id: 'price', title: 'Price', names: ['price', 'Price'] },
    ] }] },
];

describe('SearchModel', () => {
    it('lists everything for an empty query, and filters by name, description and path', () => {
        const search = new SearchModel({ sections: () => sections });
        expect(search.hits).toEqual(['home', 'cart', 'price']);
        expect(search.matched.size).toBe(0);
        search.setQuery('OFFERS');
        expect(search.hits).toEqual(['home']);
        expect(search.sections[0].groups[0].hits[0].snippet).toEqual({ before: 'The landing page with ', hit: 'offers', after: '.' });
        search.setQuery('cartpage');
        expect(search.sections[0].groups[0].hits[0].snippet?.hit).toBe('CartPage');
        search.setQuery('/cart');
        expect(search.sections[0].groups[0].hits[0].snippet).toBeUndefined();
        expect([...search.matched]).toEqual(['cart']);
        search.setQuery('nothing');
        expect(search.sections).toEqual([]);
    });
    it('keeps the cursor within the results, and close clears the query', () => {
        const search = new SearchModel({ sections: () => sections });
        search.openSearch();
        search.move(-1);
        expect(search.cursor).toBe(0);
        search.move(9);
        expect(search.current).toBe('price');
        search.setQuery('price');
        expect(search.cursor).toBe(0);
        search.close();
        expect(search.open).toBe(false);
        expect(search.query).toBe('');
    });
    it('pins named items into a first section, in the given order', () => {
        const pinned = pinFirst(sections, ['price', 'home', 'missing']);
        expect(pinned.map((s) => s.title)).toEqual(['In this trace', 'Pages', 'Parts']);
        expect(pinned[0].groups[0].items.map((i) => i.id)).toEqual(['price', 'home']);
        expect(new SearchModel({ sections: () => pinned }).hits).toEqual(['price', 'home', 'cart']);
        expect(pinFirst(sections, ['missing'])).toBe(sections);
    });
    it('starts the cursor on the first name match, and tells the owner the query changed', () => {
        let changes = 0;
        // Price's description mentions the cart, and Price is listed first here.
        const items = [{ ...sections[1], groups: [{ ...sections[1].groups[0], items: [{ ...sections[1].groups[0].items[0], desc: 'Cart total.' }] }] }, sections[0]];
        const search = new SearchModel({ sections: () => items, onQuery: () => changes++ });
        search.setQuery('cart');
        expect(search.hits).toEqual(['price', 'cart']);
        expect(search.current).toBe('cart');
        expect(changes).toBe(1);
        search.setQuery('total');
        expect(search.current).toBe('price');
    });
    it('cuts long text around the hit', () => {
        const text = 'a'.repeat(100) + 'needle' + 'b'.repeat(100);
        const snippet = snippetOf(text, 'needle', 20)!;
        expect(snippet.before.startsWith('…')).toBe(true);
        expect(snippet.after.endsWith('…')).toBe(true);
        expect(snippet.hit).toBe('needle');
    });
});
