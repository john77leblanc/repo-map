import { useCart } from '../../stores/cart';
import Button from '../shared/Button';

export default function QuantityStepper({ item }) {
    const cart = useCart();
    return (
        <span className="stepper">
            <Button variant="icon" onClick={() => cart.setQuantity(item.sku, item.quantity - 1)}>-</Button>
            <span>{item.quantity}</span>
            <Button variant="icon" onClick={() => cart.setQuantity(item.sku, item.quantity + 1)}>+</Button>
        </span>
    );
}
