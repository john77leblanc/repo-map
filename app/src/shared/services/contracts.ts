export interface ApiClient {
    get<T>(url: string, signal?: AbortSignal): Promise<T>;
    request<T>(url: string, options?: RequestInit): Promise<T>;
    stream<T>(
        url: string,
        body: unknown,
        signal: AbortSignal,
        onProgress: (text: string) => void,
        onTitle?: (title: string) => void
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
    download(name: string, data: string | Blob, type: string): void;
    reload(): void;
    /** Read the page's query parameters once and remove them from the address bar. */
    takeQuery?(): Record<string, string>;
}
/** Turns a standalone diagram SVG into other file formats. */
export interface DiagramExporter {
    /** `@font-face` CSS embedding the diagram font. */
    fontFace(): Promise<string>;
    png(svg: string, width: number, height: number): Promise<Blob>;
    pdf(svg: string, width: number, height: number, title: string): Promise<Blob>;
}
export interface Services {
    api: ApiClient;
    storage: StorageService;
    browser: BrowserService;
    exporter: DiagramExporter;
}
