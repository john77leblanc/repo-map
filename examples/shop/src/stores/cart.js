const items = [];

export function useCart() {
    return {
        items,
        add(item) {
            items.push(item);
        },
        clear() {
            items.length = 0;
        },
    };
}
