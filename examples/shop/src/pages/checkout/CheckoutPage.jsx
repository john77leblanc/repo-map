import { useCart } from '../../stores/cart';
import { placeOrder } from '../../api/orders';

export default function CheckoutPage() {
    const cart = useCart();

    async function handleSubmit(event) {
        event.preventDefault();
        const form = new FormData(event.target);
        const order = await placeOrder({ items: cart.items, email: form.get('email') });
        cart.clear();
        window.location.assign(`/orders/${order.id}`);
    }

    return (
        <form onSubmit={handleSubmit}>
            <input name="email" type="email" required />
            <button type="submit">Place order</button>
        </form>
    );
}
