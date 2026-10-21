import { chargeCard } from './payments';

const ORDERS_API_URL = process.env.ORDERS_API_URL || 'https://api.example.com/orders';

export async function placeOrder({ items, email }) {
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const payment = await chargeCard({ amount: total, email });
    const response = await fetch(ORDERS_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items, email, paymentId: payment.id }),
    });
    return response.json();
}
