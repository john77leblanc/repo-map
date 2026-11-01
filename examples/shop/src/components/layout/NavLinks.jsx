const LINKS = [
    { href: '/', label: 'Catalog' },
    { href: '/sign-in', label: 'Sign in' },
];

export default function NavLinks() {
    return (
        <nav>
            {LINKS.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
        </nav>
    );
}
