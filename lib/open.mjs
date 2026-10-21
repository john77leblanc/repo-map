import { spawn } from 'node:child_process';

/** Open a URL in the default browser; quietly does nothing if it can't. */
function openBrowser(url) {
    const [cmd, args] = process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '""', url]]
            : ['xdg-open', [url]];
    try {
        const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
        child.on('error', () => {});
        child.unref();
    } catch {
        // no browser available (SSH session, container): the URL is printed anyway
    }
}

export { openBrowser };
