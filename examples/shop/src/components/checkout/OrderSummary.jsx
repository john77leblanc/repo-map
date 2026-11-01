import { useCart } from '../../stores/cart';
import CartLine from '../cart/CartLine';
import PromoCodeField from './PromoCodeField';
import PriceLine from '../shared/PriceLine';

export default function OrderSummary({ editable = false }) {
    const cart = useCart();
    const total = cart.items.reduce((n, item) => n + item.price * item.quantity, 0);
    return (
        <aside className="order-summary">
            <ul>{cart.items.map((item) => <CartLine key={item.sku} item={item} editable={editable} />)}</ul>
            <PromoCodeField />
            <PriceLine label="Total" cents={total - cart.discount} strong />
        </aside>
    );
}
