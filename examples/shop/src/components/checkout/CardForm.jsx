import CardNumberField from './CardNumberField';
import Button from '../shared/Button';

export default function CardForm({ onSubmit }) {
    function handleSubmit(event) {
        event.preventDefault();
        onSubmit(Object.fromEntries(new FormData(event.target)));
    }

    return (
        <form onSubmit={handleSubmit}>
            <CardNumberField />
            <input name="expiry" placeholder="MM/YY" required />
            <input name="cvc" placeholder="CVC" required />
            <Button type="submit">Place order</Button>
        </form>
    );
}
