import AddressFields from './AddressFields';
import Button from '../shared/Button';

export default function ShippingStep({ onNext }) {
    function handleSubmit(event) {
        event.preventDefault();
        onNext(Object.fromEntries(new FormData(event.target)));
    }

    return (
        <form onSubmit={handleSubmit}>
            <h2>Shipping</h2>
            <input name="email" type="email" required />
            <AddressFields />
            <Button type="submit">Continue to payment</Button>
        </form>
    );
}
