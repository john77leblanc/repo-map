import { useCart } from '../../stores/cart';
import Button from '../shared/Button';

export default function AddToCartButton({ product }) {
    const cart = useCart();
    return (
        <Button onClick={() => cart.add({ sku: product.sku, name: product.name, price: product.price, quantity: 1 })}>
            Add to cart
        </Button>
    );
}
