import { describe, expect, it, vi } from 'vitest';
import { DiagramExport, diagramHtml, rasterScale, standaloneSvg, svgSize } from './diagramExport';
import type { Services } from './services/contracts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" class="fc" viewBox="0 0 300 120" width="300" height="120"><text>Cart</text></svg>';
const resolve = (variable: string) => ({ '--bg': '#fafafa', '--ink': '#111', '--line': '#ccc', '--panel': '#fff' } as Record<string, string>)[variable] || '';

function setup(source = { svg: SVG, css: '.fc{fill:var(--ink)}', title: 'Cart & checkout', filename: 'cart' }) {
    const services = {
        browser: { copy: vi.fn(), download: vi.fn(), reload: vi.fn() },
        exporter: {
            fontFace: vi.fn(async () => '@font-face{font-family:"IBM Plex Sans"}'),
            png: vi.fn(async () => new Blob(['png'])),
            pdf: vi.fn(async () => new Blob(['pdf'])),
        },
    } as unknown as Services;
    const onError = vi.fn();
    return { services, onError, model: new DiagramExport(services, () => source, onError) };
}

describe('diagram export helpers', () => {
    it('reads the diagram size and embeds the font in the standalone SVG', () => {
        expect(svgSize(SVG)).toEqual({ width: 300, height: 120 });
        const svg = standaloneSvg(SVG, '.fc{fill:var(--ink)}', resolve, '@font-face{x}');
        expect(svg).toContain('<style>@font-face{x}.fc{fill:#111}</style>');
        // Full-size background in absolute units, which svg2pdf needs for the PDF.
        expect(svg).toContain('<rect width="300" height="120" fill="#fafafa"/>');
    });
    it('keeps raster exports within browser canvas limits', () => {
        expect(rasterScale(800, 600)).toBe(2);
        expect(rasterScale(12000, 400)).toBeCloseTo(16384 / 12000);
        const scale = rasterScale(6000, 6000);
        expect(6000 * scale * 6000 * scale).toBeLessThanOrEqual(16_777_216 + 1);
    });
    it('builds an offline HTML page with the diagram inline and zoom controls', () => {
        const html = diagramHtml(SVG, { title: 'Cart <1>', resolve });
        expect(html).toMatch(/^<!doctype html>/);
        expect(html).toContain('<title>Cart &#60;1&#62;</title>');
        expect(html).toContain('<div id="stage"><svg');
        expect(html).toContain('id="fit"');
        expect(html).toContain('background:#fafafa');
        expect(html).not.toMatch(/(src|href)=["']https?:/);
    });
});

describe('DiagramExport', () => {
    it('downloads SVG and HTML with the embedded font', async () => {
        const { services, model } = setup();
        await model.run('svg', resolve);
        await model.run('html', resolve);
        const [svg, html] = vi.mocked(services.browser.download).mock.calls;
        expect(svg[0]).toBe('cart.svg');
        expect(svg[2]).toBe('image/svg+xml');
        expect(svg[1]).toContain('@font-face');
        expect(html[0]).toBe('cart.html');
        expect(html[1]).toContain('<title>Cart &#38; checkout</title>');
    });
    it('sends PNG and PDF through the exporter at the diagram size', async () => {
        const { services, model } = setup();
        const pending = model.run('png', resolve);
        expect(model.exporting).toBe('png');
        await pending;
        expect(model.exporting).toBeNull();
        expect(services.exporter.png).toHaveBeenCalledWith(expect.stringContaining('@font-face'), 300, 120);
        await model.run('pdf', resolve);
        // jsPDF gets its own copy of the font, so the PDF's SVG skips the CSS one.
        expect(services.exporter.pdf).toHaveBeenCalledWith(expect.not.stringContaining('@font-face'), 300, 120, 'Cart & checkout');
        expect(vi.mocked(services.browser.download).mock.calls.map(call => [call[0], call[2]]))
            .toEqual([['cart.png', 'image/png'], ['cart.pdf', 'application/pdf']]);
    });
    it('reports failures and still exports when the font cannot load', async () => {
        const { services, model, onError } = setup();
        vi.mocked(services.exporter.pdf).mockRejectedValueOnce(new Error('boom'));
        await model.run('pdf', resolve);
        expect(onError).toHaveBeenCalledWith("Couldn't export PDF.");
        expect(model.exporting).toBeNull();
        vi.mocked(services.exporter.fontFace).mockRejectedValueOnce(new Error('offline'));
        await model.run('svg', resolve);
        expect(vi.mocked(services.browser.download).mock.calls[0][1]).not.toContain('@font-face');
    });
    it('does nothing without a diagram', async () => {
        const services = { browser: { download: vi.fn() }, exporter: {} } as unknown as Services;
        await new DiagramExport(services, () => null, vi.fn()).run('png', resolve);
        expect(services.browser.download).not.toHaveBeenCalled();
    });
});
