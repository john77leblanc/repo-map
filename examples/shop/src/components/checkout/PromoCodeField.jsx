import { useState } from 'react';
import { useCart } from '../../stores/cart';
import Button from '../shared/Button';

export default function PromoCodeField() {
    const cart = useCart();
    const [error, setError] = useState('');

    async function apply(event) {
        event.preventDefault();
        const code = new FormData(event.target).get('code');
        const response = await fetch(`/api/promos/${encodeURIComponent(code)}`);
        if (!response.ok) { setError('That code is not valid.'); return; }
        cart.setDiscount((await response.json()).cents);
        setError('');
    }

    return (
        <form onSubmit={apply} className="promo">
            <input name="code" placeholder="Promo code" />
            <Button variant="secondary" type="submit">Apply</Button>
            {error && <small role="alert">{error}</small>}
        </form>
    );
}
