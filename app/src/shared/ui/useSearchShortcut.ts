import { useEffect, useRef } from 'react';

interface SearchShortcut {
    /** Open the search; the hook then focuses `inputId`. */
    open: () => void;
    /** Escape anywhere in the view: step back or close. Returns false when there was nothing to do. */
    escape: () => boolean;
    inputId: string;
}

/**
 * "/" or Ctrl/Cmd+K opens a view's search; Escape steps back from it. Mount only
 * in a view that is shown, and never while a modal is open. "/" typed in a field is left alone.
 */
function useSearchShortcut(shortcut: SearchShortcut) {
    const latest = useRef(shortcut);
    latest.current = shortcut;
    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if (document.querySelector('dialog:modal')) return;
            const { open, escape, inputId } = latest.current;
            if (e.key === 'Escape') {
                if (!e.defaultPrevented && escape()) e.preventDefault();
                return;
            }
            const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
            const k = e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
            if (!slash && !k) return;
            const t = e.target as HTMLElement | null;
            if (slash && t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
            e.preventDefault();
            open();
            requestAnimationFrame(() => document.getElementById(inputId)?.focus());
        };
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, []);
}

export { useSearchShortcut };
