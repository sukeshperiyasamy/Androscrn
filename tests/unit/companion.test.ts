import { strict as assert } from 'assert';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { CompanionClient } from '../../modules/companion_client';

export async function runCompanionTests(): Promise<{ passed: number; failed: number }> {
  console.log('\n--- Running Companion Client & Protocol Unit Tests ---');
  let passed = 0;
  let failed = 0;

  function record(cond: boolean, name: string) {
    if (cond) {
      passed++;
      console.log(`  ✓ PASS: ${name}`);
    } else {
      failed++;
      console.error(`  ✗ FAIL: ${name}`);
    }
  }

  const client = new CompanionClient();

  // 1. Port Forwarding Validation
  try {
    await client.setupPortForward('');
    record(false, 'setupPortForward rejects empty serial');
  } catch (err: any) {
    record(err.message.includes('Device serial is required'), 'setupPortForward rejects empty serial');
  }

  try {
    await client.setupPortForward('device123', 80);
    record(false, 'setupPortForward rejects privileged port (< 1024)');
  } catch (err: any) {
    record(err.message.includes('valid non-privileged TCP port'), 'setupPortForward rejects privileged port (< 1024)');
  }

  try {
    await client.setupPortForward('device123', 70000);
    record(false, 'setupPortForward rejects out-of-range port (> 65535)');
  } catch (err: any) {
    record(err.message.includes('valid non-privileged TCP port'), 'setupPortForward rejects out-of-range port (> 65535)');
  }

  // 2. PIN Validation
  const badPin1 = await client.submitPairingPin('');
  record(!badPin1.success && !!badPin1.error?.includes('exactly 6 numeric digits'), 'submitPairingPin rejects empty PIN');

  const badPin2 = await client.submitPairingPin('12345');
  record(!badPin2.success, 'submitPairingPin rejects 5-digit PIN');

  const badPin3 = await client.submitPairingPin('abcdef');
  record(!badPin3.success, 'submitPairingPin rejects non-numeric characters');

  // 3. Unauthenticated Control Enforcement
  const unauthCamera = await client.setCamera('front');
  record(!unauthCamera.success && unauthCamera.error === 'Authentication required', 'setCamera rejected without active session token');

  const unauthZoom = await client.setZoom(2.0);
  record(!unauthZoom.success && unauthZoom.error === 'Authentication required', 'setZoom rejected without active session token');

  const unauthTorch = await client.setTorch(true);
  record(!unauthTorch.success && unauthTorch.error === 'Authentication required', 'setTorch rejected without active session token');

  const unauthPhoto = await client.takeAndSavePhoto('./Captures');
  record(!unauthPhoto.success && unauthPhoto.error === 'Authentication required', 'takeAndSavePhoto rejected without active session token');

  // 4. Parameter Validation with Token Set
  client.setSessionToken('dummy_token_64_characters_for_parameter_validation_test_suite_001');

  const invalidFacing = await client.setCamera('top' as any);
  record(!invalidFacing.success && !!invalidFacing.error?.includes("must be 'front' or 'back'"), 'setCamera rejects invalid facing value');

  const invalidZoom = await client.setZoom(-1.5);
  record(!invalidZoom.success && !!invalidZoom.error?.includes('must be a positive number'), 'setZoom rejects negative zoom ratio');

  const nanZoom = await client.setZoom(NaN);
  record(!nanZoom.success && !!nanZoom.error?.includes('must be a positive number'), 'setZoom rejects NaN zoom ratio');

  // 5. Stream URL Construction
  client.setSessionToken(null);
  record(client.getStreamUrl() === '', 'getStreamUrl returns empty string when unauthenticated');

  client.setSessionToken('token123');
  const streamUrl = client.getStreamUrl('http://127.0.0.1:8080');
  record(streamUrl === 'http://127.0.0.1:8080/api/v1/stream?token=token123', 'getStreamUrl encodes token into authenticated stream URL');

  // 6. End-to-End Mock Companion Server Flow
  const mockServerPort = 18080;
  let activeChallengePin = '492810';
  let activeSessionToken: string | null = null;

  const mockServer = http.createServer((req, res) => {
    const urlObj = new URL(req.url || '/', `http://127.0.0.1:${mockServerPort}`);
    const pathname = urlObj.pathname;

    if (pathname === '/api/v1/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ready',
        companionVersion: '1.0.0-alpha.1',
        deviceModel: 'Mock Android Device',
        deviceProduct: 'mock_device',
        androidVersion: '13',
        sdkVersion: 33,
        isPaired: !!activeSessionToken,
        isStreaming: false,
        cameraFacing: 'back',
        currentZoom: 1.0,
        minZoom: 1.0,
        maxZoom: 10.0,
        torchOn: false
      }));
      return;
    }

    if (pathname === '/api/v1/pair' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => {
        const body = bodyStr ? JSON.parse(bodyStr) : {};
        if (!body.pin) {
          activeChallengePin = '739102';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: 'Pairing challenge generated',
            expiresInSeconds: 60
          }));
          return;
        }

        if (body.pin === activeChallengePin) {
          activeSessionToken = 'e4b8a29f3c1d0e5728a49c6b7e1f8d204a9b5c3e7f1a2d4b6c8e0f3a5b7c9d1e';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            token: activeSessionToken,
            message: 'Pairing approved'
          }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Invalid verification PIN'
          }));
        }
      });
      return;
    }

    // Authenticated endpoints check
    const authHeader = req.headers['authorization'];
    const queryToken = urlObj.searchParams.get('token');
    const providedToken = authHeader?.replace(/^Bearer\s+/i, '') || queryToken;

    if (!providedToken || providedToken !== activeSessionToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Session token required' }));
      return;
    }

    if (pathname === '/api/v1/capabilities' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        transport: 'companion_adb_loopback',
        deviceModel: 'Mock Android Device',
        torchSupported: true,
        zoomSupported: true,
        minZoom: 1.0,
        maxZoom: 10.0,
        snapshotsSupported: true,
        inAppPreviewSupported: true
      }));
      return;
    }

    if (pathname === '/api/v1/control' && req.method === 'POST') {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => {
        const body = JSON.parse(bodyStr);
        if (body.action === 'take_photo') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            photoId: 'mock_photo_1001',
            sizeBytes: 1024,
            downloadUrl: '/api/v1/photo/mock_photo_1001'
          }));
        } else if (body.action === 'disconnect') {
          activeSessionToken = null;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Disconnected' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, action: body.action }));
        }
      });
      return;
    }

    if (pathname === '/api/v1/photo/mock_photo_1001' && req.method === 'GET') {
      const mockJpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9]);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': mockJpegBytes.length });
      res.end(mockJpegBytes);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>(resolve => mockServer.listen(mockServerPort, '127.0.0.1', () => resolve()));
  const baseUrl = `http://127.0.0.1:${mockServerPort}`;

  try {
    // 6a. Check status
    const status = await client.getStatus(baseUrl);
    record(status.status === 'ready' && status.deviceModel === 'Mock Android Device', 'getStatus retrieves companion telemetry over HTTP');

    // 6b. Request pairing challenge
    const challenge = await client.requestPairingChallenge(baseUrl);
    record(challenge.success && challenge.expiresInSeconds === 60, 'requestPairingChallenge triggers PIN display on companion');

    // 6c. Invalid PIN submission
    const badSubmit = await client.submitPairingPin('000000', baseUrl);
    record(!badSubmit.success && badSubmit.error === 'Invalid verification PIN', 'submitPairingPin rejects incorrect PIN');

    // 6d. Valid PIN submission
    const goodSubmit = await client.submitPairingPin('739102', baseUrl);
    record(goodSubmit.success && typeof goodSubmit.token === 'string' && goodSubmit.token.length === 64, 'submitPairingPin accepts valid PIN and exchanges for 64-char token');

    // 6e. Query capabilities with active session
    const caps = await client.getCapabilities(baseUrl);
    record(caps.snapshotsSupported === true && caps.inAppPreviewSupported === true && caps.maxZoom === 10.0, 'getCapabilities returns verified CameraX capabilities');

    // 6f. Take and save photo
    const tempCaptures = path.join(__dirname, '..', '..', 'Captures', 'test-companion');
    const photoRes = await client.takeAndSavePhoto(tempCaptures, baseUrl);
    record(photoRes.success === true && photoRes.photoId === 'mock_photo_1001' && !!photoRes.filePath && fs.existsSync(photoRes.filePath), 'takeAndSavePhoto triggers capture and downloads binary JPEG to PC');

    // Clean up test photo
    if (photoRes.filePath && fs.existsSync(photoRes.filePath)) {
      try { fs.unlinkSync(photoRes.filePath); } catch {}
    }
    if (fs.existsSync(tempCaptures)) {
      try { fs.rmdirSync(tempCaptures); } catch {}
    }

    // 6g. Disconnect
    const disconnectOk = await client.disconnect(baseUrl);
    record(disconnectOk === true && client.getSessionToken() === null, 'disconnect revokes session token');

    // 6h. Subsequent request rejected after disconnect
    try {
      await client.getCapabilities(baseUrl);
      record(false, 'subsequent commands strictly rejected after session revocation');
    } catch (err: any) {
      record(err.message.includes('Authenticated session token is required'), 'subsequent commands strictly rejected after session revocation');
    }

  } finally {
    await new Promise<void>(resolve => mockServer.close(() => resolve()));
  }

  return { passed, failed };
}
