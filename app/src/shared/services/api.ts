import type { ApiClient } from './contracts';

export function createApiClient(fetcher: typeof fetch = fetch): ApiClient {
    async function response(url: string, options: RequestInit = {}) {
        const headers = new Headers(options.headers);
        headers.set('x-map', '1');
        headers.set('content-type', 'application/json');
        const res = await fetcher(url, { ...options, headers });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res;
    }
    return {
        async get<T>(url: string, signal?: AbortSignal) {
            return (await response(url, { signal })).json() as Promise<T>;
        },
        async request<T>(url: string, options?: RequestInit) {
            return (await response(url, options)).json() as Promise<T>;
        },
        async stream<T>(
            url: string,
            body: unknown,
            signal: AbortSignal,
            onProgress: (text: string) => void
        ) {
            const res = await response(url, { method: 'POST', body: JSON.stringify(body), signal });
            if (!res.body) throw new Error('The server returned an empty response.');
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '',
                result: T | undefined,
                failure = '';
            const consume = (line: string) => {
                if (!line.trim()) return;
                const event = JSON.parse(line);
                if (event.type === 'progress') onProgress(String(event.text || ''));
                else if (event.type === 'result') result = event as T;
                else if (event.type === 'error')
                    failure = String(event.message || 'Request failed.');
            };
            try {
                while (true) {
                    signal.throwIfAborted();
                    const { value, done } = await reader.read();
                    buffer += decoder.decode(value, { stream: !done });
                    let end;
                    while ((end = buffer.indexOf('\n')) >= 0) {
                        consume(buffer.slice(0, end));
                        buffer = buffer.slice(end + 1);
                    }
                    if (done) break;
                }
                consume(buffer);
                signal.throwIfAborted();
                if (failure) throw new Error(failure);
                if (!result)
                    throw new Error(
                        'The AI tool ended without an answer. Run repo-map doctor to check your setup.'
                    );
                return result;
            } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
        },
    };
}
