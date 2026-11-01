import NavLinks from './NavLinks';
import SearchBox from './SearchBox';
import CartBadge from './CartBadge';

export default function Header() {
    return (
        <header className="site-header">
            <a href="/" className="logo">Shop Map</a>
            <NavLinks />
            <SearchBox />
            <CartBadge />
        </header>
    );
}
