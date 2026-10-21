import fs from 'fs';
import path from 'path';
import { ConnectionRetryManager, buildConsoleLaunch } from '../../modules/connection_retry';
import { AndroidDevice, DeviceManager } from '../../modules/device_manager';

type AssertFn = (condition: boolean, message: string) => void;
type AssertEqualFn = <T>(actual: T, expected: T, message: string) => void;

class MockDeviceManager extends DeviceManager {
  public pollResponses: Array<AndroidDevice[] | Error> = [];
  public callCount = 0;

  constructor() {
    super('mock/adb.exe');
  }

  public override async getDevicesDetailed(): Promise<AndroidDevice[]> {
    this.callCount++;
    if (this.pollResponses.length === 0) {
      return [];
    }
    const next = this.pollResponses.shift()!;
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

export async function runConnectionRetryUnitTests(assert: AssertFn, assertEqual: AssertEqualFn) {
  console.log('\nTest Group: Device Connection Retry & Visible Diagnostics');

  const createAuthorizedDevice = (serial = 'xiaomi-21091116I'): AndroidDevice => ({
    serial,
    state: 'device',
    model: 'Redmi Note 11 Pro+ 5G',
    product: 'pissarroin',
    device: 'pissarroin',
    transportType: 'usb',
    connectionType: 'usb',
    guidance: 'Connected and authorized: Ready for screen mirroring and control.'
  });

  const createUnauthorizedDevice = (serial = 'unauth-phone'): AndroidDevice => ({
    serial,
    state: 'unauthorized',
    model: 'Android Device',
    product: 'unknown',
    device: 'unknown',
    transportType: 'usb',
    connectionType: 'usb',
    guidance: 'Device unauthorized: Unlock your phone and tap "Allow USB debugging".'
  });

  const createOfflineDevice = (serial = 'offline-phone'): AndroidDevice => ({
    serial,
    state: 'offline',
    model: 'Android Device',
    product: 'unknown',
    device: 'unknown',
    transportType: 'usb',
    connectionType: 'usb',
    guidance: 'Device offline: Reconnect the USB cable or toggle Developer Options -> USB debugging.'
  });

  // Scenario 1: Device found on the first attempt
  {
    const mockDm = new MockDeviceManager();
    mockDm.pollResponses = [[createAuthorizedDevice()]];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    let readyEmitted = false;
    let receivedDevices: AndroidDevice[] = [];

    manager.on('deviceReady', (devs) => {
      readyEmitted = true;
      receivedDevices = devs;
    });

    const res = await manager.startRetry({ timeoutSeconds: 5, intervalSeconds: 1, openConsole: false });
    assert(res.success, 'Scenario 1: Retry start returned success');
    const status = manager.getStatus();
    assert(!status.active, 'Scenario 1: Retry is no longer active after immediate detection');
    assertEqual(status.status, 'authorized', 'Scenario 1: Status transitioned to authorized');
    assert(readyEmitted, 'Scenario 1: deviceReady event emitted');
    assertEqual(receivedDevices.length, 1, 'Scenario 1: Exactly 1 authorized device reported');
    assertEqual(receivedDevices[0].serial, 'xiaomi-21091116I', 'Scenario 1: Serial matches authorized device');
    manager.dispose();
  }

  // Scenario 2: Device found after several attempts
  {
    const mockDm = new MockDeviceManager();
    // 1st attempt: empty, 2nd attempt: empty, 3rd attempt: authorized device
    mockDm.pollResponses = [[], [], [createAuthorizedDevice('kjizrsgekfsglvgi')]];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    const statusLog: string[] = [];

    manager.on('statusChanged', (st) => {
      statusLog.push(st.status);
    });

    const res = await manager.startRetry({ timeoutSeconds: 5, intervalSeconds: 1, openConsole: false });
    assert(res.success, 'Scenario 2: Retry started successfully');

    // Wait for subsequent polling steps
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const finalStatus = manager.getStatus();
    assertEqual(finalStatus.status, 'authorized', 'Scenario 2: Device authorized after polling');
    assert(finalStatus.attempt >= 3, `Scenario 2: Completed at least 3 attempts (Actual: ${finalStatus.attempt})`);
    assert(statusLog.includes('discovering'), 'Scenario 2: Recorded discovering status during retry');
    assertEqual(finalStatus.devices[0].serial, 'kjizrsgekfsglvgi', 'Scenario 2: Serial matches physical test serial');
    manager.dispose();
  }

  // Scenario 3: Unauthorized and offline device states
  {
    const mockDm = new MockDeviceManager();
    mockDm.pollResponses = [[createUnauthorizedDevice()], [createOfflineDevice()]];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    const recordedStatuses: string[] = [];
    const recordedMessages: string[] = [];

    manager.on('statusChanged', (st) => {
      recordedStatuses.push(st.status);
      recordedMessages.push(st.message);
    });

    await manager.startRetry({ timeoutSeconds: 5, intervalSeconds: 1, openConsole: false });
    assertEqual(manager.getStatus().status, 'unauthorized', 'Scenario 3: Detected unauthorized state');
    assert(manager.getStatus().message.includes('Allow USB debugging'), 'Scenario 3: Guidance instructs user to allow USB debugging');
    assert(manager.getStatus().active, 'Scenario 3: Retry remains active while unauthorized');

    // Advance to 2nd poll (offline)
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assertEqual(manager.getStatus().status, 'offline', 'Scenario 3: Detected offline state');
    assert(manager.getStatus().message.includes('offline'), 'Scenario 3: Offline guidance instructs cable reconnect');
    assert(manager.getStatus().active, 'Scenario 3: Retry remains active while offline');

    manager.dispose();
  }

  // Scenario 4: No device detected before timeout
  {
    const mockDm = new MockDeviceManager();
    // Always empty
    mockDm.pollResponses = [[], [], [], []];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    let timeoutEmitted = false;

    manager.on('statusChanged', (st) => {
      if (st.status === 'timeout') {
        timeoutEmitted = true;
      }
    });

    await manager.startRetry({ timeoutSeconds: 1, intervalSeconds: 0.5, openConsole: false });

    // Wait for timeout to expire
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const finalStatus = manager.getStatus();
    assert(!finalStatus.active, 'Scenario 4: Retry inactive after timeout');
    assertEqual(finalStatus.status, 'timeout', 'Scenario 4: Status is timeout');
    assert(timeoutEmitted, 'Scenario 4: Timeout status event emitted');
    assert(finalStatus.message.includes('timed out'), 'Scenario 4: Message explains timeout');

    manager.dispose();
  }

  // Scenario 5: User cancellation
  {
    const mockDm = new MockDeviceManager();
    mockDm.pollResponses = [[], [], []];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    await manager.startRetry({ timeoutSeconds: 30, intervalSeconds: 2, openConsole: false });

    assert(manager.getStatus().active, 'Scenario 5: Retry active before cancellation');
    const cancelRes = manager.cancelRetry();
    assert(cancelRes.success, 'Scenario 5: cancelRetry returned success');

    const finalStatus = manager.getStatus();
    assert(!finalStatus.active, 'Scenario 5: Retry is no longer active');
    assertEqual(finalStatus.status, 'cancelled', 'Scenario 5: Status transitioned to cancelled');
    assert(finalStatus.message.includes('cancelled'), 'Scenario 5: Message indicates cancellation');

    // Calling cancel again returns false gracefully
    const secondCancel = manager.cancelRetry();
    assert(!secondCancel.success, 'Scenario 5: Redundant cancel returns false gracefully');

    manager.dispose();
  }

  // Scenario 6: ADB process errors
  {
    const mockDm = new MockDeviceManager();
    mockDm.pollResponses = [new Error('Command failed: adb devices -l: device not responding')];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    let errorStatusEmitted = false;

    manager.on('statusChanged', (st) => {
      if (st.status === 'error') {
        errorStatusEmitted = true;
      }
    });

    await manager.startRetry({ timeoutSeconds: 5, intervalSeconds: 1, openConsole: false });
    const status = manager.getStatus();
    assertEqual(status.status, 'error', 'Scenario 6: Status transitioned to error on ADB throw');
    assert(errorStatusEmitted, 'Scenario 6: Error status event was emitted');
    assert(status.message.includes('device not responding'), 'Scenario 6: Status message captured error details');
    assert(status.active, 'Scenario 6: Retry stays active to allow recovery on subsequent polls');

    manager.dispose();
  }

  // Scenario 7: Multiple clicks and prevention of duplicate retry loops
  {
    const mockDm = new MockDeviceManager();
    mockDm.pollResponses = [[], [], []];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    const firstCall = await manager.startRetry({ timeoutSeconds: 10, intervalSeconds: 2, openConsole: false });
    assert(firstCall.success, 'Scenario 7: First startRetry call succeeded');

    // Attempt second simultaneous start
    const duplicateCall = await manager.startRetry({ timeoutSeconds: 10, intervalSeconds: 2, openConsole: false });
    assert(!duplicateCall.success, 'Scenario 7: Duplicate startRetry call was rejected');
    assert(duplicateCall.message.includes('already active'), 'Scenario 7: Rejection explains retry is already active');

    // Attempt third click
    const thirdCall = await manager.startRetry({ timeoutSeconds: 10, intervalSeconds: 2, openConsole: false });
    assert(!thirdCall.success, 'Scenario 7: Third startRetry click also rejected by guard');

    manager.dispose();
  }

  // Scenario 8: Component unmount or connection-session changes during retry
  {
    const mockDm = new MockDeviceManager();
    mockDm.pollResponses = [[], []];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    await manager.startRetry({ timeoutSeconds: 10, intervalSeconds: 1, openConsole: false });
    assert(manager.getStatus().active, 'Scenario 8: Manager is active');

    // Simulate component unmount / dispose
    manager.dispose();
    const disposedStatus = manager.getStatus();
    assert(!disposedStatus.active, 'Scenario 8: Disposed manager is inactive');
    assertEqual(disposedStatus.status, 'cancelled', 'Scenario 8: Status is cancelled');

    // Subsequent start after dispose is clean
    mockDm.pollResponses = [[createAuthorizedDevice()]];
    const newSession = await manager.startRetry({ timeoutSeconds: 5, intervalSeconds: 1, openConsole: false });
    assert(newSession.success, 'Scenario 8: New session started successfully after previous disposal');
    manager.dispose();
  }

  // Scenario 9: Correct continuation into the existing connection workflow
  {
    const mockDm = new MockDeviceManager();
    const authorizedDev = createAuthorizedDevice('pissarroin-kjizrsgekfsglvgi');
    mockDm.pollResponses = [[authorizedDev]];

    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    let emittedDevices: AndroidDevice[] = [];

    manager.on('deviceReady', (devs) => {
      emittedDevices = devs;
    });

    await manager.startRetry({ timeoutSeconds: 5, intervalSeconds: 1, openConsole: false });

    // Verify ready devices are provided to connection workflow without triggering auto-mirror
    assertEqual(emittedDevices.length, 1, 'Scenario 9: deviceReady emitted authorized devices');
    assertEqual(emittedDevices[0].serial, 'pissarroin-kjizrsgekfsglvgi', 'Scenario 9: Target serial is ready for user selection');
    assertEqual(emittedDevices[0].state, 'device', 'Scenario 9: Device state is ready');

    manager.dispose();
  }

  // Scenario 10: visible CMD console launch command (regression: broken quoting showed "syntax is incorrect")
  {
    const built = buildConsoleLaunch('C:\\My Dir\\scripts\\adb-diagnostics.cmd', 'C:\\My Dir\\bin\\adb.exe', 60, 0.5, 'C:\\Temp\\sess 1');
    assert(built !== null, 'Scenario 10: Paths with spaces are accepted');
    assertEqual(
      built!.cmdLine,
      '/k ""C:\\My Dir\\scripts\\adb-diagnostics.cmd" "C:\\My Dir\\bin\\adb.exe" 60 1 "C:\\Temp\\sess 1""',
      'Scenario 10: cmd /k line wraps script and quoted args in one outer quote pair'
    );
    assertEqual(Buffer.from(built!.encoded, 'base64').toString('utf16le'), built!.psCommand, 'Scenario 10: Encoded command round-trips');
    assertEqual(buildConsoleLaunch('C:\\a&calc\\x.cmd', 'adb.exe', 60, 2, 'C:\\t'), null, 'Scenario 10: cmd metacharacters in paths are rejected');
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'adb-diagnostics.cmd'), 'utf8');
    assert(/%ATTEMPT% GTR 1 if exist .*success\.flag/.test(script), 'Scenario 10: Script always runs first ADB attempt before honoring success.flag');
  }

  // Scenario 11: overlapping polls are not allowed
  {
    const mockDm = new MockDeviceManager();
    let calls = 0;
    (mockDm as any).getDevicesDetailed = async () => { calls++; await new Promise((r) => setTimeout(r, 120)); return []; };
    const manager = new ConnectionRetryManager(mockDm, 'mock/adb.exe');
    const started = manager.startRetry({ timeoutSeconds: 30, intervalSeconds: 0.05, openConsole: false });
    await new Promise((r) => setTimeout(r, 500));
    const concurrent = calls;
    manager.cancelRetry();
    await started;
    assert(concurrent <= 5, `Scenario 11: Slow ADB polls do not stack (calls in 500ms: ${concurrent})`);
    manager.dispose();
  }
}
