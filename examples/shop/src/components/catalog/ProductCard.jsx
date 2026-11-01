import PriceLine from '../shared/PriceLine';
import AddToCartButton from '../product/AddToCartButton';

export default function ProductCard({ product }) {
    return (
        <article className="product-card">
            <a href={`/products/${product.sku}`}><img src={product.images[0]} alt="" /> {product.name}</a>
            <PriceLine label="Price" cents={product.price} />
            <AddToCartButton product={product} />
        </article>
    );
}
