const PAYMENTS_API_URL = process.env.PAYMENTS_API_URL || 'https://payments.example.com/charges';

export async function chargeCard({ amount, email }) {
    const response = await fetch(PAYMENTS_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount, receiptEmail: email }),
    });
    if (!response.ok) {
        throw new Error('Payment declined');
    }
    return response.json();
}
