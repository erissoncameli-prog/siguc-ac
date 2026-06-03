const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL:     process.env.TEST_BASE_URL || 'http://localhost:5500',
    headless:    true,
    screenshot:  'only-on-failure',
    video:       'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
