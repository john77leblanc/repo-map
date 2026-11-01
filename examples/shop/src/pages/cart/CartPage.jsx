import { useCart } from '../../stores/cart';
import Header from '../../components/layout/Header';
import CartLine from '../../components/cart/CartLine';
import PriceLine from '../../components/shared/PriceLine';
import Footer from '../../components/layout/Footer';

export default function CartPage() {
    const cart = useCart();
    const subtotal = cart.items.reduce((n, item) => n + item.price * item.quantity, 0);
    return (
        <>
            <Header />
            <main>
                <h1>Your cart</h1>
                <ul>{cart.items.map((item) => <CartLine key={item.sku} item={item} />)}</ul>
                <PriceLine label="Subtotal" cents={subtotal} strong />
                <a href="/checkout">Check out</a>
            </main>
            <Footer />
        </>
    );
}
