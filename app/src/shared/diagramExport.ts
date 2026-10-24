/** Make a generated diagram independent of application CSS and theme variables. */
function standaloneSvg(svg: string, styles: string, resolve: (variable: string) => string) {
    const css = styles.replace(/var\((--[\w-]+)\)/g, (_, variable: string) => resolve(variable));
    const bg = resolve('--bg').replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
    return svg.replace(/^<svg([^>]*)>/,
        `<svg$1><style>${css.replace(/</g, '&lt;')}</style><rect width="100%" height="100%" fill="${bg}"/>`);
}

function diagramFilename(title: string, fallback: string) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
}

export { standaloneSvg, diagramFilename };
