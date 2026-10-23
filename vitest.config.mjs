import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['app/src/**/*.test.{ts,tsx}'],
        setupFiles: ['app/src/test-setup.ts'],
        restoreMocks: true,
    },
});
