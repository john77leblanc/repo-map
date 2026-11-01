import { useEffect, useState } from 'react';
import ProductCard from './ProductCard';

export default function ProductGrid() {
    const [products, setProducts] = useState([]);
    useEffect(() => {
        fetch('/api/products' + window.location.search).then((r) => r.json()).then(setProducts);
    }, []);
    return <div className="grid">{products.map((p) => <ProductCard key={p.sku} product={p} />)}</div>;
}
