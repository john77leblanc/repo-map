import { useCart } from '../../stores/cart';
import PriceLine from '../shared/PriceLine';
import QuantityStepper from './QuantityStepper';
import Button from '../shared/Button';

export default function CartLine({ item, editable = true }) {
    const cart = useCart();
    return (
        <li className="cart-line">
            <PriceLine label={item.name} cents={item.price * item.quantity} />
            {editable && <QuantityStepper item={item} />}
            {editable && <Button variant="link" onClick={() => cart.remove(item.sku)}>Remove</Button>}
        </li>
    );
}
