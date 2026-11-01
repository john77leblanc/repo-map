import { useState } from 'react';
import CardBrandIcon from './CardBrandIcon';

export default function CardNumberField() {
    const [number, setNumber] = useState('');
    return (
        <label>
            Card number
            <input name="number" value={number} onChange={(e) => setNumber(e.target.value)} required />
            <CardBrandIcon number={number} />
        </label>
    );
}
