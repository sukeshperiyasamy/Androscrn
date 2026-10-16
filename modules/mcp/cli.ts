#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AndroScrnMcpServer } from './server';

async function main() {
  // Resolve bundled adb.exe
  const candidatePaths = [
    path.resolve(__dirname, '../../bin/scrcpy-win64/adb.exe'),
    path.resolve(__dirname, '../../../bin/scrcpy-win64/adb.exe'),
    path.resolve(process.cwd(), 'bin/scrcpy-win64/adb.exe'),
    path.resolve(process.cwd(), 'resources/bin/scrcpy-win64/adb.exe')
  ];

  const adbPath = candidatePaths.find(p => fs.existsSync(p)) || 'adb';
  const capturesDir = path.resolve(process.cwd(), 'Captures');

  if (!fs.existsSync(capturesDir)) {
    try {
      fs.mkdirSync(capturesDir, { recursive: true });
    } catch {
      // Ignore if cannot create
    }
  }

  process.stderr.write(`[AndroScrn MCP] Starting server with ADB binary: ${adbPath}\n`);

  // Initialize Windows Named Pipe Control Bridge to Desktop
  const { McpControlClient } = await import('./control-bridge');
  const controlClient = new McpControlClient();
  controlClient.connect().then(connected => {
    if (connected) {
      process.stderr.write(`[AndroScrn MCP] Connected to AndroScrn desktop control bridge.\n`);
    } else {
      process.stderr.write(`[AndroScrn MCP] Desktop control bridge not available (will retry in background).\n`);
    }
  }).catch(() => {});

  const serverInstance = new AndroScrnMcpServer({
    name: 'androscrn-mcp',
    version: '1.0.0',
    adbPath,
    capturesDir,
    controlBridge: controlClient
  });

  const transport = new StdioServerTransport();
  await serverInstance.server.connect(transport);

  process.stderr.write(`[AndroScrn MCP] Connected to stdio transport successfully.\n`);
}

main().catch(err => {
  process.stderr.write(`[AndroScrn MCP] Fatal error: ${err?.message || err}\n`);
  process.exit(1);
});
