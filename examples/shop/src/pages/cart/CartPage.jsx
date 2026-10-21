import { useCart } from '../../stores/cart';

export default function CartPage() {
    const cart = useCart();
    return (
        <main>
            <h1>Your cart</h1>
            {cart.items.map((item) => <p key={item.sku}>{item.name} × {item.quantity}</p>)}
            <a href="/checkout">Check out</a>
        </main>
    );
}
