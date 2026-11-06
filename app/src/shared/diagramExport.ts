import { makeAutoObservable, runInAction } from 'mobx';
import type { Services } from './services/contracts';

type ExportFormat = 'svg' | 'png' | 'pdf' | 'html';
type Resolve = (variable: string) => string;

/** What a view hands over to export: its diagram SVG, the CSS it needs, and names. */
interface ExportSource {
    svg: string;
    css: string;
    /** Human title, used by the HTML page and PDF metadata. */
    title: string;
    /** File name without extension. */
    filename: string;
}

const TYPES: Record<ExportFormat, string> = {
    svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf', html: 'text/html;charset=utf-8',
};
const LABELS: Record<ExportFormat, string> = { svg: 'SVG', png: 'PNG', pdf: 'PDF', html: 'HTML' };

/** Make a generated diagram independent of application CSS and theme variables. */
function standaloneSvg(svg: string, styles: string, resolve: Resolve, fontFace = '') {
    const css = fontFace + styles.replace(/var\((--[\w-]+)\)/g, (_, variable: string) => resolve(variable));
    const bg = escapeAttr(resolve('--bg'));
    // Explicit size: svg2pdf (PDF export) reads percentages as 100 units, not the full diagram.
    const { width, height } = svgSize(svg);
    const size = width && height ? `width="${width}" height="${height}"` : 'width="100%" height="100%"';
    return svg.replace(/^<svg([^>]*)>/,
        `<svg$1><style>${css.replace(/</g, '&lt;')}</style><rect ${size} fill="${bg}"/>`);
}

function diagramFilename(title: string, fallback: string) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function escapeAttr(text: string) {
    return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

/** The diagram's own size, from the root `<svg width height>`. */
function svgSize(svg: string) {
    const root = /^<svg[^>]*>/.exec(svg)?.[0] || '';
    const read = (name: string) => Number(new RegExp(`\\s${name}="([\\d.]+)"`).exec(root)?.[1]) || 0;
    return { width: read('width'), height: read('height') };
}

/** Browsers cap canvas size (Chrome ~16k per side, Safari ~16.7M pixels), so big diagrams render below `want`. */
function rasterScale(width: number, height: number, want = 2) {
    if (width <= 0 || height <= 0) return want;
    return Math.min(want, 16384 / width, 16384 / height, Math.sqrt(16_777_216 / (width * height)));
}

/** A one-file page with the diagram inline and pan/zoom; makes no network requests. */
function diagramHtml(svg: string, { title, resolve }: { title: string; resolve: Resolve }) {
    const color = (variable: string, fallback: string) => escapeAttr(resolve(variable) || fallback).replace(/[;{}]/g, '');
    const css = `html,body{margin:0;height:100%;background:${color('--bg', '#fff')};color:${color('--ink', '#111')};font:13px/1.4 system-ui,sans-serif}`
        + '#view{position:fixed;inset:0;overflow:hidden;cursor:grab;touch-action:none}#view.drag{cursor:grabbing}'
        + '#stage{position:absolute;left:0;top:0;transform-origin:0 0}#stage>svg{display:block}'
        + '.bar{position:fixed;top:12px;right:12px;display:flex;gap:4px;align-items:center}'
        + `.bar button{font:inherit;min-width:32px;padding:4px 10px;border:1px solid ${color('--line', '#ccc')};border-radius:6px;background:${color('--panel', '#fff')};color:inherit;cursor:pointer}`
        + '.bar output{min-width:44px;text-align:right;opacity:.7}'
        + '.title{position:fixed;top:12px;left:12px;margin:0;font-size:14px;font-weight:600;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
    const script = `(()=>{const v=document.getElementById('view'),g=document.getElementById('stage'),z=document.getElementById('zoom');
const svg=g.firstElementChild,W=svg.width.baseVal.value,H=svg.height.baseVal.value;let s=1,x=0,y=0;
const draw=()=>{g.style.transform='translate('+x+'px,'+y+'px) scale('+s+')';z.value=Math.round(s*100)+'%'};
const at=(k,cx,cy)=>{const n=Math.min(8,Math.max(.05,s*k));x=cx-(cx-x)*n/s;y=cy-(cy-y)*n/s;s=n;draw()};
const mid=k=>at(k,innerWidth/2,innerHeight/2);
const fit=()=>{s=Math.min(1,(innerWidth-48)/W,(innerHeight-72)/H);x=(innerWidth-W*s)/2;y=Math.max(56,(innerHeight-H*s)/2);draw()};
v.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey)at(Math.exp(-e.deltaY/200),e.clientX,e.clientY);else{x-=e.deltaX;y-=e.deltaY;draw()}},{passive:false});
let p=null;v.addEventListener('pointerdown',e=>{p={x:e.clientX-x,y:e.clientY-y};v.setPointerCapture(e.pointerId);v.classList.add('drag')});
v.addEventListener('pointermove',e=>{if(p){x=e.clientX-p.x;y=e.clientY-p.y;draw()}});
const up=()=>{p=null;v.classList.remove('drag')};v.addEventListener('pointerup',up);v.addEventListener('pointercancel',up);
document.getElementById('in').onclick=()=>mid(1.2);document.getElementById('out').onclick=()=>mid(1/1.2);
document.getElementById('fit').onclick=fit;document.getElementById('one').onclick=()=>{mid(1/s)};
addEventListener('keydown',e=>{if(e.key==='+'||e.key==='=')mid(1.2);else if(e.key==='-')mid(1/1.2);else if(e.key==='0')mid(1/s);else if(e.key==='f')fit()});
fit()})();`;
    const name = title.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + `<title>${name}</title><style>${css}</style></head><body>`
        + `<div id="view"><div id="stage">${svg}</div></div><h1 class="title">${name}</h1>`
        + '<div class="bar" role="group" aria-label="Zoom"><output id="zoom">100%</output>'
        + '<button id="out" type="button" aria-label="Zoom out">−</button><button id="fit" type="button">Fit</button>'
        + '<button id="one" type="button">100%</button><button id="in" type="button" aria-label="Zoom in">+</button></div>'
        + `<script>${script}</script></body></html>`;
}

/**
 * Export state for one diagram view: builds each format from the view's source
 * and downloads it. PNG and PDF go through the injected exporter service.
 */
class DiagramExport {
    /** The format being built, while PNG/PDF work is in flight. */
    exporting: ExportFormat | null = null;
    constructor(
        private readonly services: Services,
        private readonly source: () => ExportSource | null,
        private readonly onError: (message: string) => void,
    ) {
        makeAutoObservable<this, 'services' | 'source' | 'onError'>(this, { services: false, source: false, onError: false }, { autoBind: true });
    }
    async run(format: ExportFormat, resolve: Resolve) {
        const source = this.source();
        if (!source || this.exporting) return;
        const { exporter, browser } = this.services;
        this.exporting = format;
        try {
            // The PDF registers the font with jsPDF itself; the rest embed it as CSS.
            const fontFace = format === 'pdf' ? '' : await exporter.fontFace().catch(() => '');
            const svg = standaloneSvg(source.svg, source.css, resolve, fontFace);
            const { width, height } = svgSize(svg);
            const data = format === 'png' ? await exporter.png(svg, width, height)
                : format === 'pdf' ? await exporter.pdf(svg, width, height, source.title)
                    : format === 'html' ? diagramHtml(svg, { title: source.title, resolve })
                        : svg;
            browser.download(`${source.filename}.${format}`, data, TYPES[format]);
        } catch {
            this.onError(`Couldn't export ${LABELS[format]}.`);
        } finally {
            runInAction(() => { this.exporting = null; });
        }
    }
}

export { standaloneSvg, diagramFilename, diagramHtml, svgSize, rasterScale, DiagramExport };
export type { ExportFormat, ExportSource };
