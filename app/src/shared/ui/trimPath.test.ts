import { describe, it, expect } from 'vitest';
import { trimPath } from './trimPath';

describe('trimPath', () => {
    it('keeps the last segments behind .../', () => {
        expect(trimPath('src/app/folder/file.js', 9)).toBe('src/app/folder/file.js');
        expect(trimPath('src/app/folder/file.js', 4)).toBe('src/app/folder/file.js');
        expect(trimPath('src/app/folder/file.js', 2)).toBe('.../folder/file.js');
        expect(trimPath('src/app/folder/file.js', 0)).toBe('.../file.js');
        expect(trimPath('file.js', 1)).toBe('file.js');
    });
});
