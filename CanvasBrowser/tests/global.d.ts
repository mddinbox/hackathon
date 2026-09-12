import type { CanvasBrowserTestApi } from '../src/testApi';

declare global {
  interface Window {
    __canvasBrowser: CanvasBrowserTestApi;
  }
}

export {};
