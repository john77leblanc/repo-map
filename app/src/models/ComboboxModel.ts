import { makeAutoObservable } from 'mobx';

export interface ComboboxOption {
    /** What choosing it puts in the field. */
    value: string;
    label: string;
    /** Small text on the right, e.g. "2d · 4 ahead". */
    meta?: string;
    /** Heading it is listed under. */
    group: string;
    /** Greyed out (still choosable), e.g. a branch with nothing to review. */
    muted?: boolean;
    /** A hint shown on hover, e.g. the last commit's subject. */
    title?: string;
}

/** At most this many options are drawn; typing narrows the rest. */
const MAX_SHOWN = 100;

/**
 * A text field with a filtered list of suggestions (the shared `Combobox`).
 * Free text is always allowed; the list only helps. Open state and the active
 * option live here, so views stay plain.
 */
export class ComboboxModel {
    value = '';
    options: ComboboxOption[] = [];
    open = false;
    active = -1;
    /** Filter by what was typed; off right after choosing, so the whole list shows again. */
    private filtering = false;
    constructor(value = '', private readonly onChange?: (value: string) => void) {
        this.value = value;
        makeAutoObservable<this, 'onChange'>(this, { onChange: false }, { autoBind: true });
    }
    /** Options matching the typed text (case-insensitive, anywhere in the label or value), at most 100. */
    get filtered(): ComboboxOption[] {
        const query = this.filtering ? this.value.trim().toLowerCase() : '';
        const hits = query ? this.options.filter((o) => (o.label + ' ' + o.value).toLowerCase().includes(query)) : this.options;
        return hits.slice(0, MAX_SHOWN);
    }
    /** How many matching options were left out of the list. */
    get hidden(): number {
        const query = this.filtering ? this.value.trim().toLowerCase() : '';
        const total = query ? this.options.filter((o) => (o.label + ' ' + o.value).toLowerCase().includes(query)).length : this.options.length;
        return Math.max(0, total - MAX_SHOWN);
    }
    /** The filtered options in their groups, in first-seen group order. */
    get groups(): { group: string; options: { option: ComboboxOption; index: number }[] }[] {
        const out: { group: string; options: { option: ComboboxOption; index: number }[] }[] = [];
        this.filtered.forEach((option, index) => {
            let g = out.find((x) => x.group === option.group);
            if (!g) out.push((g = { group: option.group, options: [] }));
            g.options.push({ option, index });
        });
        return out;
    }
    get activeOption(): ComboboxOption | null {
        return this.filtered[this.active] || null;
    }
    setOptions(options: ComboboxOption[]) {
        this.options = options;
        if (this.active >= this.filtered.length) this.active = -1;
    }
    /** Set the value from outside (prefill), without opening the list. */
    setValue(value: string) {
        this.value = value;
        this.filtering = false;
        this.active = -1;
    }
    type(value: string) {
        this.value = value;
        this.filtering = true;
        this.open = true;
        this.active = -1;
        this.onChange?.(value);
    }
    show() {
        this.open = true;
    }
    toggle() {
        this.open = !this.open;
        if (this.open) this.filtering = false;
        this.active = -1;
    }
    close() {
        this.open = false;
        this.active = -1;
    }
    /** Move the active option up or down, opening the list first. */
    move(step: number) {
        if (!this.open) {
            this.open = true;
            this.active = -1;
        }
        const n = this.filtered.length;
        if (!n) return;
        this.active = this.active < 0 ? (step > 0 ? 0 : n - 1) : (this.active + step + n) % n;
    }
    choose(option: ComboboxOption | null = this.activeOption) {
        if (!option) return false;
        this.value = option.value;
        this.filtering = false;
        this.close();
        this.onChange?.(option.value);
        return true;
    }
}
