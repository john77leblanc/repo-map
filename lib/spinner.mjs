/** A single-line terminal spinner that leaves progress messages in the scrollback. */
function createSpinner(label, output = process.stdout) {
    const frames = ['|', '/', '-', '\\'];
    let frame = 0;
    let stopped = false;
    const clear = () => output.write('\r\x1b[2K');
    const draw = () => output.write(`\r  ${frames[frame++ % frames.length]} ${label}`);
    let timer;
    if (output.isTTY) {
        draw();
        timer = setInterval(draw, 100);
        timer.unref();
    }
    return {
        progress(text) {
            if (timer && !stopped) {
                clear();
            }
            output.write(`${text}\n`);
            if (timer && !stopped) {
                draw();
            }
        },
        stop() {
            if (stopped) {
                return;
            }
            stopped = true;
            if (timer) {
                clearInterval(timer);
                clear();
            }
        },
    };
}

export { createSpinner };
