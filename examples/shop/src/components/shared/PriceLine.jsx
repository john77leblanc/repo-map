const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function PriceLine({ label, cents, strong = false }) {
    return (
        <p className={'price-line' + (strong ? ' strong' : '')}>
            <span>{label}</span>
            <span>{format.format(cents / 100)}</span>
        </p>
    );
}
