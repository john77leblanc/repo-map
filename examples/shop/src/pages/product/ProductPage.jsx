import { useEffect, useState } from 'react';
import Header from '../../components/layout/Header';
import ProductGallery from '../../components/product/ProductGallery';
import PriceLine from '../../components/shared/PriceLine';
import AddToCartButton from '../../components/product/AddToCartButton';
import ReviewThread from '../../components/product/ReviewThread';
import Footer from '../../components/layout/Footer';

export default function ProductPage({ sku }) {
    const [product, setProduct] = useState(null);
    useEffect(() => {
        fetch(`/api/products/${sku}`).then((r) => r.json()).then(setProduct);
    }, [sku]);
    if (!product) return <p>Loading...</p>;
    return (
        <>
            <Header />
            <main className="product">
                <ProductGallery images={product.images} />
                <h1>{product.name}</h1>
                <PriceLine label="Price" cents={product.price} strong />
                <AddToCartButton product={product} />
                <ReviewThread reviews={product.reviews} />
            </main>
            <Footer />
        </>
    );
}
