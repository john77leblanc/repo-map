import { createServer } from 'node:http';
import { createOrder, getOrder } from './routes/orders.js';

const routes = {
    'POST /orders': createOrder,
    'GET /orders/:id': getOrder,
};

export const server = createServer(async (req, res) => {
    const [path] = req.url.split('?');
    const key = Object.keys(routes).find((k) => {
        const [method, pattern] = k.split(' ');
        const re = new RegExp('^' + pattern.replace(/:\w+/g, '[^/]+') + '$');
        return method === req.method && re.test(path);
    });
    if (!key) {
        res.writeHead(404).end();
        return;
    }
    await routes[key](req, res);
});
