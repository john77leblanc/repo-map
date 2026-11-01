const BRANDS = [[/^4/, 'Visa'], [/^5[1-5]/, 'Mastercard'], [/^3[47]/, 'Amex']];

export default function CardBrandIcon({ number }) {
    const brand = BRANDS.find(([pattern]) => pattern.test(number))?.[1];
    return brand ? <span className="card-brand">{brand}</span> : null;
}
