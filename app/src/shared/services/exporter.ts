import type { DiagramExporter } from './contracts';
import { rasterScale } from '../diagramExport';
import plexRegularWoff from '@ibm/plex-sans/fonts/complete/woff2/IBMPlexSans-Regular.woff2?url';
import plexSemiBoldWoff from '@ibm/plex-sans/fonts/complete/woff2/IBMPlexSans-SemiBold.woff2?url';
import plexRegularTtf from '@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf?url';
import plexSemiBoldTtf from '@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf?url';

const FAMILY = 'IBM Plex Sans';
/** jsPDF's largest page side, in points. */
const PDF_MAX = 14400;

async function base64(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Font ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}

/** Load once, retry after a failure. */
function cached<T>(load: () => Promise<T>) {
    let promise: Promise<T> | null = null;
    return () => {
        promise ??= load().catch((error) => { promise = null; throw error; });
        return promise;
    };
}

const fontFace = cached(async () => {
    const [regular, semibold] = await Promise.all([base64(plexRegularWoff), base64(plexSemiBoldWoff)]);
    const face = (data: string, weight: string) =>
        `@font-face{font-family:"${FAMILY}";font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2")}`;
    return face(regular, '400') + face(semibold, '600 700');
});
const pdfFonts = cached(() => Promise.all([base64(plexRegularTtf), base64(plexSemiBoldTtf)]));

async function png(svg: string, width: number, height: number) {
    const scale = rasterScale(width, height);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No canvas');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image too large')), 'image/png'));
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function pdf(svg: string, width: number, height: number, title: string) {
    // Loaded on first use, so the main bundle stays small.
    const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
    // CSS px → pt, scaled down only when the page would pass jsPDF's limit.
    const k = Math.min(0.75, PDF_MAX / width, PDF_MAX / height);
    const w = width * k, h = height * k;
    const doc = new jsPDF({ unit: 'pt', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', compress: true });
    doc.setProperties({ title, creator: 'repo-map' });
    try {
        const [regular, semibold] = await pdfFonts();
        doc.addFileToVFS('IBMPlexSans-Regular.ttf', regular);
        doc.addFileToVFS('IBMPlexSans-SemiBold.ttf', semibold);
        // svg2pdf names weights as jsPDF styles: 400 'normal', 700 'bold', others e.g. '600normal'.
        doc.addFont('IBMPlexSans-Regular.ttf', FAMILY, 'normal');
        doc.addFont('IBMPlexSans-Regular.ttf', FAMILY, '500normal');
        doc.addFont('IBMPlexSans-SemiBold.ttf', FAMILY, '600normal');
        doc.addFont('IBMPlexSans-SemiBold.ttf', FAMILY, 'bold');
    } catch {
        // Without the font, svg2pdf falls back to a built-in PDF font.
    }
    const element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
    // svg2pdf reads styles from a live element, so mount it out of sight while drawing.
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden';
    holder.appendChild(document.importNode(element, true));
    document.body.appendChild(holder);
    try {
        await svg2pdf(holder.firstElementChild as Element, doc, { x: 0, y: 0, width: w, height: h });
    } finally {
        holder.remove();
    }
    return doc.output('blob');
}

function createDiagramExporter(): DiagramExporter {
    return { fontFace, png, pdf };
}

export { createDiagramExporter };
