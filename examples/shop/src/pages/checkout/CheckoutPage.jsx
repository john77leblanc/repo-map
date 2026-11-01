import { useCart } from '../../stores/cart';
import { placeOrder } from '../../api/orders';
import Header from '../../components/layout/Header';
import CheckoutSteps from '../../components/checkout/CheckoutSteps';
import OrderSummary from '../../components/checkout/OrderSummary';

export default function CheckoutPage() {
    const cart = useCart();

    async function handleSubmit({ shipping, card }) {
        const order = await placeOrder({ items: cart.items, email: shipping.email });
        cart.clear();
        window.location.assign(`/orders/${order.id}`);
    }

    return (
        <>
            <Header />
            <main className="checkout">
                <CheckoutSteps onSubmit={handleSubmit} />
                <OrderSummary />
            </main>
        </>
    );
}
