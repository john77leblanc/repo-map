import { describe, it, expect, vi } from 'vitest';
import { createApiClient } from './api';
import { createStorage } from './browser';

describe('API and browser boundaries', () => {
    it('sends the API guard and handles split unicode and an unterminated final event', async () => {
        const bytes = new TextEncoder().encode(
            '{"type":"progress","text":"Préparing"}\n{"type":"result","value":3}'
        );
        const fetcher = vi.fn(
            async () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(bytes.slice(0, 32));
                            controller.enqueue(bytes.slice(32));
                            controller.close();
                        },
                    })
                )
        );
        const api = createApiClient(fetcher as typeof fetch);
        const progress = vi.fn();
        expect(
            await api.stream(
                '/api/trace',
                { prompt: 'test' },
                new AbortController().signal,
                progress
            )
        ).toEqual({ type: 'result', value: 3 });
        expect(progress).toHaveBeenCalledWith('Préparing');
        const options = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1];
        expect(new Headers(options.headers).get('x-map')).toBe('1');
    });
    it('rejects stream errors and missing results', async () => {
        const api = createApiClient(
            vi.fn(async () => new Response('{"type":"error","message":"failed"}\n')) as typeof fetch
        );
        await expect(
            api.stream('/api/trace', {}, new AbortController().signal, () => {})
        ).rejects.toThrow('failed');
        const empty = createApiClient(vi.fn(async () => new Response('')) as typeof fetch);
        await expect(
            empty.stream('/api/trace', {}, new AbortController().signal, () => {})
        ).rejects.toThrow('without an answer');
    });
    it('tolerates disabled or corrupt browser storage', () => {
        const storage = createStorage({
            getItem: () => '{bad',
            setItem: () => {
                throw new Error('disabled');
            },
        });
        expect(storage.get('key', 12)).toBe(12);
        expect(() => storage.set('key', 3)).not.toThrow();
    });
});
