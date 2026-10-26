const orders = new Map();
let next = 1;

export async function insertOrder(order) {
    const saved = { ...order, id: String(next++), createdAt: new Date().toISOString() };
    orders.set(saved.id, saved);
    return saved;
}

export async function findOrder(id) {
    return orders.get(id) || null;
}
