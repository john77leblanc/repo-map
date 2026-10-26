import { insertOrder, findOrder } from '../db/orders.js';
import { publish } from '../workers/queue.js';

async function readJson(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    return JSON.parse(body || '{}');
}

// POST /orders: called by the shop's checkout after the card is charged
export async function createOrder(req, res) {
    const { items, email, paymentId } = await readJson(req);
    const order = await insertOrder({ items, email, paymentId });
    publish('order.placed', { id: order.id, email });
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(order));
}

// GET /orders/:id
export async function getOrder(req, res) {
    const id = req.url.split('/').pop();
    const order = await findOrder(id);
    res.writeHead(order ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(order || {}));
}
