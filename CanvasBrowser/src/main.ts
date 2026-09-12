import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) {
  throw new Error('CanvasBrowser: #app root element is missing.');
}

const app = mountApp(root);

async function finishStartup(): Promise<void> {
  // The test read-surface is only ever bundled into the test artifact.
  if (import.meta.env.MODE === 'test') {
    const { installTestApi } = await import('./testApi');
    installTestApi(app);
  }
  document.body.setAttribute('data-canvas-browser-ready', 'true');
}

void finishStartup();
