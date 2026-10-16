import { _electron as electron } from 'playwright';
import path from 'path';

async function testElectronLaunch() {
  console.log('Testing Playwright Electron Launch...');
  const appPath = path.resolve(__dirname, '../../apps/desktop');
  console.log('Target app path:', appPath);

  try {
    const app = await electron.launch({
      args: ['.'],
      cwd: appPath
    });

    console.log('Electron launched successfully!');
    const window = await app.firstWindow();
    const title = await window.title();
    console.log('Window title:', title);

    await app.close();
    console.log('Electron closed cleanly.');
  } catch (err) {
    console.error('Electron launch test error:', err);
    process.exit(1);
  }
}

testElectronLaunch();
