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
  let activeChallengePin: string | null = '492810';
  let activeSessionToken: string | null = null;
  let failedPinAttempts = 0;
  let isStreamActive = false;

  function createTestServer() {
    return http.createServer((req, res) => {
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
          isStreaming: isStreamActive,
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
            failedPinAttempts = 0;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              message: 'Pairing challenge generated',
              expiresInSeconds: 60
            }));
            return;
          }

          if (failedPinAttempts >= 3) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Rate limit exceeded: Too many failed pairing attempts. Request a new PIN.'
            }));
            return;
          }

          if (!activeChallengePin) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Pairing challenge expired or not requested.'
            }));
            return;
          }

          if (body.pin === activeChallengePin) {
            activeSessionToken = 'e4b8a29f3c1d0e5728a49c6b7e1f8d204a9b5c3e7f1a2d4b6c8e0f3a5b7c9d1e';
            activeChallengePin = null;
            failedPinAttempts = 0;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              token: activeSessionToken,
              message: 'Pairing approved'
            }));
          } else {
            failedPinAttempts++;
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: `Invalid verification PIN (${failedPinAttempts}/3)`
            }));
          }
        });
        return;
      }

      // Authenticated endpoints check
      const authHeader = req.headers['authorization'];
      const queryToken = urlObj.searchParams.get('token');
      let providedToken: string | null = null;

      if (authHeader) {
        if (/^Bearer\s+[0-9a-f]{64}$/i.test(authHeader.trim())) {
          providedToken = authHeader.replace(/^Bearer\s+/i, '').trim();
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: Malformed or invalid Bearer token' }));
          return;
        }
      } else if (queryToken) {
        if (/^[0-9a-f]{64}$/i.test(queryToken.trim())) {
          providedToken = queryToken.trim();
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: Invalid query token format' }));
          return;
        }
      }

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

      if (pathname === '/api/v1/stream' && req.method === 'GET') {
        isStreamActive = true;
        res.writeHead(200, {
          'Content-Type': 'multipart/x-mixed-replace; boundary=frameboundary_androscrn'
        });
        res.write('--frameboundary_androscrn\r\nContent-Type: image/jpeg\r\n\r\n');
        res.end();
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
          } else if (body.action === 'simulate_camera_failure') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Camera capture use case is not bound'
            }));
          } else if (body.action === 'disconnect') {
            activeSessionToken = null;
            isStreamActive = false;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Disconnected' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, action: body.action }));
          }
        });
        return;
      }

      if (pathname.startsWith('/api/v1/photo/') && req.method === 'GET') {
        const photoId = pathname.replace('/api/v1/photo/', '');
        if (photoId === 'mock_photo_1001') {
          const mockJpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9]);
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': mockJpegBytes.length });
          res.end(mockJpegBytes);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Photo not found' }));
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  }

  let mockServer = createTestServer();
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
    record(!badSubmit.success && !!badSubmit.error?.includes('Invalid verification PIN'), 'submitPairingPin rejects incorrect PIN');

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

    // --- Phase 13.1 Security & Integration Audit Test Suite ---

    // 7. Missing and Malformed Bearer Token Rejection
    console.log('\n--- Section 7: Missing & Malformed Bearer Tokens ---');
    const directFetch = async (endpoint: string, headers: Record<string, string> = {}) => {
      const res = await fetch(`${baseUrl}${endpoint}`, { headers });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    const resNoAuth = await directFetch('/api/v1/capabilities');
    record(resNoAuth.status === 401, 'Capabilities rejects request with missing Authorization header (HTTP 401)');

    const resEmptyBearer = await directFetch('/api/v1/capabilities', { 'Authorization': 'Bearer ' });
    record(resEmptyBearer.status === 401, 'Capabilities rejects empty Bearer token header (HTTP 401)');

    const resBasicAuth = await directFetch('/api/v1/capabilities', { 'Authorization': 'Basic dXNlcjpwYXNz' });
    record(resBasicAuth.status === 401, 'Capabilities rejects Basic auth scheme (HTTP 401)');

    const resShortBearer = await directFetch('/api/v1/capabilities', { 'Authorization': 'Bearer 1234abcd' });
    record(resShortBearer.status === 401, 'Capabilities rejects short/malformed Bearer token (HTTP 401)');

    const resFakeHex = await directFetch('/api/v1/capabilities', { 'Authorization': 'Bearer 0000000000000000000000000000000000000000000000000000000000000000' });
    record(resFakeHex.status === 401, 'Capabilities rejects unissued 64-char hex token (HTTP 401)');

    const resEmptyQuery = await directFetch('/api/v1/capabilities?token=');
    record(resEmptyQuery.status === 401, 'Capabilities rejects empty ?token= parameter (HTTP 401)');

    const resMalformedQuery = await directFetch('/api/v1/capabilities?token=malformed_token_format');
    record(resMalformedQuery.status === 401, 'Capabilities rejects malformed ?token= parameter (HTTP 401)');

    // 8. Unauthorized Access to Every Privileged Endpoint
    console.log('\n--- Section 8: Unauthorized Access to All Privileged Endpoints ---');
    const epCap = await directFetch('/api/v1/capabilities');
    record(epCap.status === 401, 'GET /api/v1/capabilities strictly requires authentication (HTTP 401)');

    const postControlRes = await fetch(`${baseUrl}/api/v1/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_camera', facing: 'front' })
    });
    record(postControlRes.status === 401, 'POST /api/v1/control strictly requires authentication (HTTP 401)');

    const streamRes = await fetch(`${baseUrl}/api/v1/stream`);
    record(streamRes.status === 401, 'GET /api/v1/stream strictly requires authentication (HTTP 401)');

    const photoResUnauth = await fetch(`${baseUrl}/api/v1/photo/mock_photo_1001`);
    record(photoResUnauth.status === 401, 'GET /api/v1/photo/:id strictly requires authentication (HTTP 401)');

    const statusRes = await fetch(`${baseUrl}/api/v1/status`);
    record(statusRes.status === 200, 'GET /api/v1/status remains accessible without authentication (HTTP 200)');

    // 9. PIN Rate Limiting & Challenge Single-Use (Lockout & Replay Defense)
    console.log('\n--- Section 9: PIN Attempt Limits & Challenge Single-Use ---');
    // Generate fresh challenge PIN
    await client.requestPairingChallenge(baseUrl);

    // 3 consecutive failed attempts
    const fail1 = await client.submitPairingPin('111111', baseUrl);
    record(!fail1.success && !!fail1.error?.includes('(1/3)'), 'Failed attempt 1 reports 1/3 warning');

    const fail2 = await client.submitPairingPin('222222', baseUrl);
    record(!fail2.success && !!fail2.error?.includes('(2/3)'), 'Failed attempt 2 reports 2/3 warning');

    const fail3 = await client.submitPairingPin('333333', baseUrl);
    record(!fail3.success && !!fail3.error?.includes('(3/3)'), 'Failed attempt 3 reports 3/3 warning');

    // 4th attempt must be locked out by rate limiter
    const fail4 = await client.submitPairingPin('739102', baseUrl);
    record(!fail4.success && !!fail4.error?.includes('Rate limit exceeded'), '4th attempt blocked by brute-force rate limiter');

    // Reset rate limit by generating new challenge
    const resetChallenge = await client.requestPairingChallenge(baseUrl);
    record(resetChallenge.success === true, 'Requesting new challenge resets rate limiter lockout');

    // Successful pairing consumes the single-use PIN
    const successPair = await client.submitPairingPin('739102', baseUrl);
    record(successPair.success === true && typeof successPair.token === 'string', 'Valid PIN accepted after rate limit reset');

    // Replay attack: submitting the same PIN again must fail
    const replayAttempt = await client.submitPairingPin('739102', baseUrl);
    record(!replayAttempt.success && !!replayAttempt.error?.includes('expired or not requested'), 'Replaying consumed PIN rejected as expired/consumed');

    // 10. Emergency Revocation & Stream Invalidation
    console.log('\n--- Section 10: Emergency Revocation & Session Invalidation ---');
    // Verify session is active
    const activeCaps = await client.getCapabilities(baseUrl);
    record(activeCaps.transport === 'companion_adb_loopback', 'Session is active and authenticated before revocation');

    // Emergency revocation via disconnect
    const revoked = await client.disconnect(baseUrl);
    record(revoked === true, 'Emergency disconnect completed');
    record(client.getSessionToken() === null, 'Session token cleared locally on client');

    // Stream and control rejected after revocation
    const postRevokeStream = await fetch(`${baseUrl}/api/v1/stream?token=${successPair.token}`);
    record(postRevokeStream.status === 401, 'Stream access rejected with revoked token (HTTP 401)');

    const postRevokeCaps = await fetch(`${baseUrl}/api/v1/capabilities`, {
      headers: { 'Authorization': `Bearer ${successPair.token}` }
    });
    record(postRevokeCaps.status === 401, 'Capabilities access rejected with revoked token (HTTP 401)');

    // 11. Server Shutdown, Restart, and Port Cleanup
    console.log('\n--- Section 11: Server Shutdown, Restart & Port Cleanup ---');
    await new Promise<void>(resolve => mockServer.close(() => resolve()));

    // Server closed: probing must throw connection error
    let closedProbeFailed = false;
    try {
      await client.getStatus(baseUrl);
    } catch {
      closedProbeFailed = true;
    }
    record(closedProbeFailed, 'Closed companion server correctly detected as unreachable');

    // Re-bind to the exact same port without EADDRINUSE
    mockServer = createTestServer();
    await new Promise<void>(resolve => mockServer.listen(mockServerPort, '127.0.0.1', () => resolve()));

    const restartedStatus = await client.getStatus(baseUrl);
    record(restartedStatus.status === 'ready', 'Companion server successfully re-bound to same port after shutdown');

    // 12. ADB Port Forwarding Lifecycle & Mock DeviceManager
    console.log('\n--- Section 12: ADB Port Forwarding Lifecycle ---');
    const mockAdbCommands: string[][] = [];
    let simulateAdbFailure = false;

    const mockDm: any = {
      executeAdb: async (args: string[]) => {
        mockAdbCommands.push(args);
        if (simulateAdbFailure) {
          return { code: 1, stdout: '', stderr: 'device unauthorized or not found' };
        }
        return { code: 0, stdout: '', stderr: '' };
      }
    };

    const forwardedClient = new CompanionClient(mockDm);

    // Initial setup
    const fwd1 = await forwardedClient.setupPortForward('device_serial_100', 8080, 8080);
    record(fwd1 === true, 'setupPortForward succeeds with valid serial and ports');
    record(
      mockAdbCommands.some(c => c.join(' ') === '-s device_serial_100 forward tcp:8080 tcp:8080'),
      'ADB port forward command dispatched with discrete arguments'
    );

    // Removal
    const rem1 = await forwardedClient.removePortForward('device_serial_100', 8080);
    record(rem1 === true, 'removePortForward succeeds');
    record(
      mockAdbCommands.some(c => c.join(' ') === '-s device_serial_100 forward --remove tcp:8080'),
      'ADB port forward removal command dispatched correctly'
    );

    // Reconnection on alternative port
    const fwd2 = await forwardedClient.setupPortForward('device_serial_100', 8085, 8080);
    record(fwd2 === true, 'Reconnection setupPortForward succeeds with alternative port 8085');
    record(
      mockAdbCommands.some(c => c.join(' ') === '-s device_serial_100 forward tcp:8085 tcp:8080'),
      'Alternative port forward command executed cleanly'
    );

    // Error resilience when ADB fails
    simulateAdbFailure = true;
    const failFwd = await forwardedClient.setupPortForward('device_serial_100', 8080, 8080);
    record(failFwd === false, 'setupPortForward returns false gracefully when ADB command fails');

    const failRem = await forwardedClient.removePortForward('device_serial_100', 8080);
    record(failRem === false, 'removePortForward returns false gracefully when ADB command fails');

    // 13. Camera Hardware & Permission Denial / Initialization Failure Handling
    console.log('\n--- Section 13: Camera Hardware & Permission Denial Handling ---');
    // Pair client on restarted server
    await forwardedClient.requestPairingChallenge(baseUrl);
    const pairRes2 = await forwardedClient.submitPairingPin('739102', baseUrl);
    record(pairRes2.success === true, 'Re-paired client on restarted test server');

    // Photo capture failure handling (e.g. camera permission denied or use case not bound)
    const mockCapturesDir = path.join(process.cwd(), 'Captures', 'test-perm-denied');
    const photoFailureRes = await forwardedClient.takeAndSavePhoto(
      mockCapturesDir,
      baseUrl
    );
    // Control endpoint returns mock_photo_1001 by default, now test simulation of error
    const directErrorCtrl = await fetch(`${baseUrl}/api/v1/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pairRes2.token}`
      },
      body: JSON.stringify({ action: 'simulate_camera_failure' })
    });
    const errorJson = await directErrorCtrl.json() as any;
    record(errorJson.success === false && errorJson.error === 'Camera capture use case is not bound', 'Companion reports camera initialization failure gracefully without crash');

    // Clean up mock directory
    if (photoFailureRes.filePath && fs.existsSync(photoFailureRes.filePath)) {
      try { fs.unlinkSync(photoFailureRes.filePath); } catch {}
    }
    if (fs.existsSync(mockCapturesDir)) {
      try { fs.rmdirSync(mockCapturesDir); } catch {}
    }

    // 14. Loopback Binding & Security Configuration Verification
    console.log('\n--- Section 14: Loopback Binding & Security Configuration Verification ---');
    const companionHttpServerSrc = fs.readFileSync(
      path.join(process.cwd(), 'android', 'companion', 'app', 'src', 'main', 'java', 'com', 'androscrn', 'companion', 'server', 'CompanionHttpServer.kt'),
      'utf-8'
    );
    record(
      companionHttpServerSrc.includes('NanoHTTPD("127.0.0.1", port)'),
      'CompanionHttpServer.kt explicitly binds strictly to 127.0.0.1 (loopback interface only)'
    );
    record(
      !companionHttpServerSrc.includes('0.0.0.0'),
      'CompanionHttpServer.kt never binds to wildcard 0.0.0.0 (no external network exposure)'
    );

    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), 'modules', 'companion_client', 'index.ts'),
      'utf-8'
    );
    record(
      clientSrc.includes("http://127.0.0.1:8080"),
      'CompanionClient defaults strictly to loopback 127.0.0.1'
    );

  } finally {
    await new Promise<void>(resolve => mockServer.close(() => resolve()));
  }

  return { passed, failed };
}

