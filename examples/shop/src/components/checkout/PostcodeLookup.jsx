import { useState } from 'react';

export default function PostcodeLookup() {
    const [hint, setHint] = useState('');

    async function lookup(event) {
        const response = await fetch(`/api/postcodes/${encodeURIComponent(event.target.value)}`);
        setHint(response.ok ? (await response.json()).city : 'Unknown postcode');
    }

    return (
        <label>
            Postcode <input name="postcode" onBlur={lookup} required />
            {hint && <small>{hint}</small>}
        </label>
    );
}
