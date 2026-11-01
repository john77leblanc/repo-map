import { useState } from 'react';
import ShippingStep from './ShippingStep';
import PaymentStep from './PaymentStep';

export default function CheckoutSteps({ onSubmit }) {
    const [step, setStep] = useState('shipping');
    const [shipping, setShipping] = useState(null);
    if (step === 'shipping') {
        return <ShippingStep onNext={(address) => { setShipping(address); setStep('payment'); }} />;
    }
    return <PaymentStep onBack={() => setStep('shipping')} onPay={(card) => onSubmit({ shipping, card })} />;
}
