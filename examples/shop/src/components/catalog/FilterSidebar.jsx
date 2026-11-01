import { useState } from 'react';

const CATEGORIES = ['All', 'Mugs', 'Posters', 'Stickers'];

export default function FilterSidebar() {
    const params = new URLSearchParams(window.location.search);
    const [category, setCategory] = useState(params.get('category') || 'All');

    function pick(next) {
        setCategory(next);
        window.location.assign(next === 'All' ? '/' : `/?category=${next}`);
    }

    return (
        <aside className="filters">
            {CATEGORIES.map((c) => <label key={c}><input type="radio" checked={c === category} onChange={() => pick(c)} /> {c}</label>)}
        </aside>
    );
}
