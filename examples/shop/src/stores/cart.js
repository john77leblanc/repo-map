const items = [];
let discount = 0;

export function useCart() {
    return {
        items,
        get discount() {
            return discount;
        },
        add(item) {
            const line = items.find((i) => i.sku === item.sku);
            if (line) line.quantity += item.quantity;
            else items.push(item);
        },
        remove(sku) {
            const index = items.findIndex((i) => i.sku === sku);
            if (index >= 0) items.splice(index, 1);
        },
        setQuantity(sku, quantity) {
            if (quantity <= 0) return this.remove(sku);
            const line = items.find((i) => i.sku === sku);
            if (line) line.quantity = quantity;
        },
        setDiscount(cents) {
            discount = cents;
        },
        clear() {
            items.length = 0;
            discount = 0;
        },
    };
}
