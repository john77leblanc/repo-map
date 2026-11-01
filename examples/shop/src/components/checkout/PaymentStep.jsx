import SavedCardPicker from './SavedCardPicker';
import CardForm from './CardForm';
import Button from '../shared/Button';

export default function PaymentStep({ onBack, onPay }) {
    return (
        <section>
            <h2>Payment</h2>
            <SavedCardPicker onPick={onPay} />
            <CardForm onSubmit={onPay} />
            <Button variant="link" onClick={onBack}>Back to shipping</Button>
        </section>
    );
}
