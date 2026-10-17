import fs from 'fs';
import path from 'path';
import { DiagnosticsManager } from '../../modules/diagnostics';
import { DeviceManager } from '../../modules/device_manager';

type AssertFn = (condition: boolean, name: string) => void;

/**
 * Static and behavioral checks that the local OCR feature keeps document images and text on this computer:
 * no network APIs in the module, no document content in logs, no paths sent to the renderer or into diagnostics.
 */
export async function runDocumentPrivacyTests(assert: AssertFn) {
  console.log('\nTest Group: Document Intelligence Privacy & Network Boundaries');
  const root = path.resolve(__dirname, '../../..');
  const diDir = path.join(root, 'modules', 'document_intelligence');
  const source = fs
    .readdirSync(diDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => fs.readFileSync(path.join(diDir, f), 'utf8'))
    .join('\n');

  assert(!/\b(fetch|XMLHttpRequest|WebSocket)\b|from 'https?'|require\('https?'\)|\bnet\.(connect|Socket)|node-fetch/.test(source), 'The document module contains no network API usage (nothing can upload images or text)');
  assert(!/console\.(log|info|warn|error)/.test(source), 'The document module never writes document content to the console');

  const main = fs.readFileSync(path.join(root, 'apps', 'desktop', 'electron', 'main.ts'), 'utf8');
  const logLines = main.split(/\r?\n/).filter(l => l.includes('appLog(') && l.includes('Document '));
  assert(logLines.length >= 3, 'The document handlers log their outcomes');
  assert(
    logLines.every(l => !/\.text\b|rawText|filePath|sourceName|originalBytes|fileName/.test(l)),
    'Document log lines record outcomes and counts only, never text or file names'
  );

  const summary = main.slice(main.indexOf('function summarizeDocument'), main.indexOf('function documentsFolder'));
  assert(summary.length > 0 && !/originalBytes|filePath|path\./.test(summary), 'The document summary sent to the renderer carries no file system path');

  const importCapture = main.slice(main.indexOf("ipcMain.handle('document-import-capture'"), main.indexOf("ipcMain.handle('document-process'"));
  assert(/parseCaptureName\(payload\)/.test(importCapture) && /getCapturesFolder\(\)/.test(importCapture), 'Importing a capture validates the file name and stays inside the captures folder');

  const dm = new DeviceManager('C:\\nonexistent\\adb.exe');
  (dm as any).executeAdb = async () => ({ stdout: 'List of devices attached\n', stderr: '', code: 0 });
  const report = await new DiagnosticsManager(dm).generateDiagnosticBundle();
  assert(!/documents[\\/]|\bocr\b|\.pdf/i.test(report), 'Diagnostic reports contain no document paths, OCR text or PDF names');
}
