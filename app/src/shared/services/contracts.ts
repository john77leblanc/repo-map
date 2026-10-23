export interface ApiClient {
    get<T>(url: string, signal?: AbortSignal): Promise<T>;
    request<T>(url: string, options?: RequestInit): Promise<T>;
    stream<T>(
        url: string,
        body: unknown,
        signal: AbortSignal,
        onProgress: (text: string) => void
    ): Promise<T>;
}
export interface StorageService {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
    getRaw(key: string): string | null;
    setRaw(key: string, value: string): void;
}
export interface BrowserService {
    copy(text: string): Promise<void>;
    download(name: string, text: string, type: string): void;
    reload(): void;
}
export interface Services {
    api: ApiClient;
    storage: StorageService;
    browser: BrowserService;
}
