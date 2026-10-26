const handlers = new Map();

export function subscribe(topic, handler) {
    handlers.set(topic, [...(handlers.get(topic) || []), handler]);
}

export function publish(topic, payload) {
    for (const handler of handlers.get(topic) || []) setTimeout(() => handler(payload), 0);
}
