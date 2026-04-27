import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // SwiftShader = software WebGL; prevents Phaser's framebuffer crash in headless Chromium
      args: ['--use-gl=swiftshader', '--enable-unsafe-webgl'],
    },
  },
  // Expect the dev server to already be running (npm run dev)
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
