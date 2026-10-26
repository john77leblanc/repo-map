import { subscribe } from './queue.js';

const MAIL_API_URL = process.env.MAIL_API_URL || 'https://mail.example.com/send';

// Emails a receipt once an order is placed
subscribe('order.placed', async ({ id, email }) => {
    await fetch(MAIL_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: email, template: 'receipt', orderId: id }),
    });
});
