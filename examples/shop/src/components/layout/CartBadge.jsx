import { useCart } from '../../stores/cart';

export default function CartBadge() {
    const cart = useCart();
    const count = cart.items.reduce((n, item) => n + item.quantity, 0);
    return <a href="/cart" className="cart-badge">Cart ({count})</a>;
}
