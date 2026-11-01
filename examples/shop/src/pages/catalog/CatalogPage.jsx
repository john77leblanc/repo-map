import Header from '../../components/layout/Header';
import FilterSidebar from '../../components/catalog/FilterSidebar';
import ProductGrid from '../../components/catalog/ProductGrid';
import Footer from '../../components/layout/Footer';

export default function CatalogPage() {
    return (
        <>
            <Header />
            <main className="catalog">
                <FilterSidebar />
                <ProductGrid />
            </main>
            <Footer />
        </>
    );
}
