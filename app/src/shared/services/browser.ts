import type { BrowserService, StorageService } from './contracts';

export function createStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): StorageService {
    return {
        get<T>(key: string, fallback: T): T {
            try {
                const raw = storage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            try {
                storage.setItem(key, JSON.stringify(value));
            } catch {
                /* Storage can be disabled. */
            }
        },
        getRaw(key) {
            try {
                return storage.getItem(key);
            } catch {
                return null;
            }
        },
        setRaw(key, value) {
            try {
                storage.setItem(key, value);
            } catch {
                /* Storage can be disabled. */
            }
        },
    };
}
export function createBrowserService(): BrowserService {
    return {
        copy: (text) => navigator.clipboard.writeText(text),
        reload: () => window.location.reload(),
        download(name, text, type) {
            const url = URL.createObjectURL(new Blob([text], { type }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = name;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
    };
}
