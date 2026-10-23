import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/browser',
    fullyParallel: true,
    use: { baseURL: 'http://127.0.0.1:4499', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
    webServer: { command: 'npm run build && node scripts/e2e-server.mjs', url: 'http://127.0.0.1:4499', reuseExistingServer: false, timeout: 120000 },
});
