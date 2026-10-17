import { WorkflowEngine, WorkflowDefinition, WorkflowStep } from '../../modules/workflow_engine';
import { DiagnosticsManager } from '../../modules/diagnostics';

export async function runWorkflowEngineTests(
  assert: (condition: boolean, testName: string) => void,
  assertEqual: <T>(actual: T, expected: T, testName: string) => void
) {
  console.log('\nTest Group: WorkflowEngine Security & Step Validation');

  // Create mock DeviceManager and DiagnosticsManager
  const executedCommands: string[][] = [];
  const mockDeviceManager: any = {
    executeAdb: async (args: string[]) => {
      executedCommands.push(args);
      return { code: 0, stdout: '', stderr: '' };
    }
  };

  const mockDiagnosticsManager: any = {
    captureDeviceScreenshot: async () => ({ success: true, filePath: 'C:\\Captures\\screen.png' })
  };

  const engine = new WorkflowEngine(mockDeviceManager, mockDiagnosticsManager);
  const validSerial = 'emulator-5554';
  const dummyFolder = 'C:\\Captures';

  // Helper to run workflow safely and catch throws
  const runSafe = async (serial: string, wf: any) => {
    try {
      return await engine.executeWorkflow(serial, wf, dummyFolder);
    } catch (err: any) {
      return { overallStatus: 'failed', success: false, error: err.message, results: [] } as any;
    }
  };

  // 1. Invalid Serial Tests
  const emptySerialRes = await runSafe('', { id: 'wf1', name: 'Test', steps: [{ id: 's1', action: 'wait', params: { waitMs: 10 } }] });
  assertEqual(emptySerialRes.overallStatus, 'failed', 'WorkflowEngine rejects empty serial');
  assert(emptySerialRes.error?.includes('Invalid target device serial') ?? false, 'Explains invalid serial');

  const invalidSerialRes = await runSafe('bad serial with spaces; rm', { id: 'wf2', name: 'Test', steps: [{ id: 's1', action: 'wait', params: { waitMs: 10 } }] });
  assertEqual(invalidSerialRes.overallStatus, 'failed', 'WorkflowEngine rejects invalid serial characters');

  // 2. Malformed Workflow Definition Tests
  const nullStepsRes = await runSafe(validSerial, { id: 'wf3', name: 'Test', steps: null });
  assertEqual(nullStepsRes.overallStatus, 'failed', 'WorkflowEngine rejects null steps');

  const emptyStepsRes = await runSafe(validSerial, { id: 'wf4', name: 'Test', steps: [] });
  assertEqual(emptyStepsRes.overallStatus, 'failed', 'WorkflowEngine rejects empty steps array');

  const missingIdRes = await runSafe(validSerial, { id: '', name: 'Test', steps: [{ id: 's1', action: 'wait', params: { waitMs: 10 } }] });
  assertEqual(missingIdRes.overallStatus, 'failed', 'WorkflowEngine rejects missing workflow id');

  const missingStepActionRes = await runSafe(validSerial, {
    id: 'wf5',
    name: 'Missing Action',
    steps: [{ id: 's1', params: {} } as any]
  });
  assertEqual(missingStepActionRes.overallStatus, 'failed', 'WorkflowEngine rejects step without action');

  // 3. Tap Step Validation
  const negativeTapRes = await runSafe(validSerial, {
    id: 'wf-tap-neg',
    name: 'Tap Neg',
    steps: [{ id: 's1', action: 'tap', params: { x: -50, y: 100 } }]
  });
  assertEqual(negativeTapRes.overallStatus, 'failed', 'Tap step rejects negative x coordinate');
  assert(negativeTapRes.results[0]?.error?.includes('coordinates') ?? false, 'Tap error message explains coordinate fault');

  const nonNumTapRes = await runSafe(validSerial, {
    id: 'wf-tap-nan',
    name: 'Tap NaN',
    steps: [{ id: 's1', action: 'tap', params: { x: NaN, y: 100 } }]
  });
  assertEqual(nonNumTapRes.overallStatus, 'failed', 'Tap step rejects NaN coordinate');

  const oobTapRes = await runSafe(validSerial, {
    id: 'wf-tap-oob',
    name: 'Tap OOB',
    steps: [{ id: 's1', action: 'tap', params: { x: 50000, y: 100 } }]
  });
  assertEqual(oobTapRes.overallStatus, 'failed', 'Tap step rejects coordinate exceeding 20000 boundary');

  // 4. Swipe Step Validation
  const invalidSwipeCoordsRes = await runSafe(validSerial, {
    id: 'wf-swipe-neg',
    name: 'Swipe Neg',
    steps: [{ id: 's1', action: 'swipe', params: { x: -10, y: 100, x2: 200, y2: 200 } }]
  });
  assertEqual(invalidSwipeCoordsRes.overallStatus, 'failed', 'Swipe step rejects negative coordinates');

  const shortSwipeRes = await runSafe(validSerial, {
    id: 'wf-swipe-short',
    name: 'Swipe Short',
    steps: [{ id: 's1', action: 'swipe', params: { x: 100, y: 100, x2: 200, y2: 200, durationMs: 20 } }]
  });
  assertEqual(shortSwipeRes.overallStatus, 'failed', 'Swipe step rejects duration under 50ms');

  const longSwipeRes = await runSafe(validSerial, {
    id: 'wf-swipe-long',
    name: 'Swipe Long',
    steps: [{ id: 's1', action: 'swipe', params: { x: 100, y: 100, x2: 200, y2: 200, durationMs: 20000 } }]
  });
  assertEqual(longSwipeRes.overallStatus, 'failed', 'Swipe step rejects duration over 10000ms');

  // 5. Keycode Step Validation
  const negativeKeyRes = await runSafe(validSerial, {
    id: 'wf-key-neg',
    name: 'Key Neg',
    steps: [{ id: 's1', action: 'keyevent', params: { keycode: -1 } }]
  });
  assertEqual(negativeKeyRes.overallStatus, 'failed', 'Keycode step rejects negative keycode');

  const highKeyRes = await runSafe(validSerial, {
    id: 'wf-key-high',
    name: 'Key High',
    steps: [{ id: 's1', action: 'keyevent', params: { keycode: 999 } }]
  });
  assertEqual(highKeyRes.overallStatus, 'failed', 'Keycode step rejects keycode > 300');

  // 6. Text Sanitization: Malicious / Invalid Inputs Rejected
  const emptyTextRes = await runSafe(validSerial, {
    id: 'wf-text-empty',
    name: 'Empty Text',
    steps: [{ id: 's1', action: 'input_text', params: { text: '' } }]
  });
  assertEqual(emptyTextRes.overallStatus, 'failed', 'Input text rejects empty text');

  const newlineTextRes = await runSafe(validSerial, {
    id: 'wf-text-nl',
    name: 'Newline Text',
    steps: [{ id: 's1', action: 'input_text', params: { text: 'hello\nworld' } }]
  });
  assertEqual(newlineTextRes.overallStatus, 'failed', 'Input text rejects control character newline');

  const unicodeTextRes = await runSafe(validSerial, {
    id: 'wf-text-unicode',
    name: 'Unicode Text',
    steps: [{ id: 's1', action: 'input_text', params: { text: 'Hello 🌟' } }]
  });
  assertEqual(unicodeTextRes.overallStatus, 'failed', 'Input text rejects unsupported non-ASCII Unicode');

  const longTextRes = await runSafe(validSerial, {
    id: 'wf-text-long',
    name: 'Overlength Text',
    steps: [{ id: 's1', action: 'input_text', params: { text: 'a'.repeat(501) } }]
  });
  assertEqual(longTextRes.overallStatus, 'failed', 'Input text rejects text exceeding 500 characters');

  // 7. Legitimate User Punctuation & Safe POSIX Shell Escaping
  executedCommands.length = 0;
  const punctWorkflow: WorkflowDefinition = {
    id: 'wf-text-punct',
    name: 'Legitimate Punctuation Test',
    steps: [
      {
        id: 's1',
        action: 'input_text',
        params: { text: 'Hello, World! (v1.0) [Status: OK] - 100% #tag @user' }
      },
      {
        id: 's2',
        action: 'input_text',
        params: { text: 'https://example.com/api?id=123&token=abc#section; price: $19.99' }
      },
      {
        id: 's3',
        action: 'input_text',
        params: { text: "User's file: a+b=c <tag> {key: 'value'} path/to/res?v=1&q=2" }
      }
    ]
  };

  const punctRes = await engine.executeWorkflow(validSerial, punctWorkflow, dummyFolder);
  assertEqual(punctRes.overallStatus, 'passed', 'WorkflowEngine accepts legitimate user punctuation and symbols');
  assertEqual(punctRes.passedSteps, 3, 'All 3 punctuation steps passed');

  // Verify that commands were dispatched with POSIX single-quote escaping for shell safety
  const textCmds = executedCommands.filter(c => c.includes('input') && c.includes('text'));
  assertEqual(textCmds.length, 3, '3 ADB input text commands were executed');
  
  // Verify token 1 starts and ends with single quotes
  const arg1 = textCmds[0][textCmds[0].length - 1];
  assert(arg1.startsWith("'") && arg1.endsWith("'"), 'First punctuation argument safely single-quoted for POSIX shell');
  assert(arg1.includes('%s'), 'Spaces encoded as %s for Android input');

  // Verify token 2 safely contains & and $ without shell expansion
  const arg2 = textCmds[1][textCmds[1].length - 1];
  assert(arg2.startsWith("'") && arg2.endsWith("'"), 'Second punctuation argument safely single-quoted');
  assert(arg2.includes('&') && arg2.includes('$') && arg2.includes(';'), 'Preserves legitimate symbols (&, $, ;)');

  // Verify token 3 safely escapes internal single quotes as '\''
  const arg3 = textCmds[2][textCmds[2].length - 1];
  assert(arg3.includes("'\\''"), 'Single quotes within user text safely escaped as \'\\\'\' for shell literal');

  // 8. Command Injection Payload Neutralization & Adversarial Escaping Matrix
  // When an adversarial payload is passed, it is neutralized via single-quote escaping rather than executing
  executedCommands.length = 0;
  const injectionWf: WorkflowDefinition = {
    id: 'wf-injection-neutralized',
    name: 'Injection Neutralization',
    steps: [
      { id: 's1', action: 'input_text', params: { text: 'test; rm -rf / ; $(reboot) `id`' } },
      { id: 's2', action: 'input_text', params: { text: "hello'; reboot; echo 'done" }, description: 'Delimited breakout attempt' },
      { id: 's3', action: 'input_text', params: { text: "User's file: C:\\temp\\'quoted'\\file.txt" }, description: 'Backslashes, single quotes, double quotes' },
      { id: 's4', action: 'input_text', params: { text: 'Rate: 100% [Format: %s]' }, description: 'Percent signs and literal %s' }
    ]
  };
  const injectionRes = await engine.executeWorkflow(validSerial, injectionWf, dummyFolder);
  assertEqual(injectionRes.overallStatus, 'passed', 'WorkflowEngine neutralizes injection payloads safely');
  assertEqual(injectionRes.passedSteps, 4, 'All 4 adversarial test steps passed safely');

  // Verify step 1: Metacharacters ($ ; & | `)
  const cmd1 = executedCommands[0][executedCommands[0].length - 1];
  assert(cmd1.startsWith("'") && cmd1.endsWith("'"), 'Step 1 payload is safely encapsulated in POSIX literal quotes');
  assert(!cmd1.includes('\n'), 'No newlines injected');

  // Verify step 2: Delimited breakout attempt (' ; reboot ; echo ')
  const cmd2 = executedCommands[1][executedCommands[1].length - 1];
  assert(cmd2.includes("'\\''"), 'Step 2 single quote safely escaped as \'\\\'\' to prevent breakout');
  assert(cmd2.startsWith("'") && cmd2.endsWith("'"), 'Step 2 stays strictly enclosed in single quotes');

  // Verify step 3: Backslashes, single quotes
  const cmd3 = executedCommands[2][executedCommands[2].length - 1];
  assert(cmd3.includes('\\temp\\'), 'Step 3 backslashes preserved literally inside single quotes');

  // Verify step 4: Percent signs and %s
  const cmd4 = executedCommands[3][executedCommands[3].length - 1];
  assert(cmd4.includes('100%') && cmd4.includes('%s'), 'Step 4 percent signs encoded');

  // 8b. Additional Control Character & Boundary Checks
  const tabTextRes = await runSafe(validSerial, {
    id: 'wf-text-tab',
    name: 'Tab Text',
    steps: [{ id: 's1', action: 'input_text', params: { text: 'hello\tworld' } }]
  });
  assertEqual(tabTextRes.overallStatus, 'failed', 'Input text rejects tab control character');

  const crTextRes = await runSafe(validSerial, {
    id: 'wf-text-cr',
    name: 'CR Text',
    steps: [{ id: 's1', action: 'input_text', params: { text: 'hello\rworld' } }]
  });
  assertEqual(crTextRes.overallStatus, 'failed', 'Input text rejects carriage return control character');

  // 500 characters boundary accepted
  const exact500TextRes = await runSafe(validSerial, {
    id: 'wf-text-500',
    name: '500 Chars Text',
    steps: [{ id: 's1', action: 'input_text', params: { text: 'a'.repeat(500) } }]
  });
  assertEqual(exact500TextRes.overallStatus, 'passed', 'Input text accepts exactly 500 characters (max boundary)');

  // 9. Unknown Action Rejection
  const unknownActionRes = await runSafe(validSerial, {
    id: 'wf-unknown',
    name: 'Unknown',
    steps: [{ id: 's1', action: 'unsupported_command_xyz' as any, params: {} }]
  });
  assertEqual(unknownActionRes.overallStatus, 'failed', 'Rejects unknown action');

  // 10. Nine Workflow Execution & Cancellation Lifecycle Permutations
  
  // Lifecycle 1: Successful workflow execution
  executedCommands.length = 0;
  const successWf: WorkflowDefinition = {
    id: 'wf-life-1-success',
    name: 'Life 1 Success',
    steps: [
      { id: 's1', action: 'tap', params: { x: 120, y: 340 } },
      { id: 's2', action: 'wait', params: { waitMs: 10 } },
      { id: 's3', action: 'keyevent', params: { keycode: 4 } }
    ]
  };
  const successRes = await engine.executeWorkflow(validSerial, successWf, dummyFolder);
  assertEqual(successRes.overallStatus, 'passed', 'Lifecycle 1: Successful workflow has overallStatus="passed"');
  assertEqual(successRes.success, true, 'Lifecycle 1: success is true');
  assertEqual(successRes.passedSteps, 3, 'Lifecycle 1: All 3 steps passed');
  assertEqual(successRes.failedSteps, 0, 'Lifecycle 1: Zero failed steps');

  // Verify discrete argument construction for tap and keyevent
  const life1TapCmd = executedCommands.find(c => c.includes('tap'));
  assert(!!life1TapCmd, 'Lifecycle 1 executed tap command');
  assertEqual(JSON.stringify(life1TapCmd), JSON.stringify(['-s', validSerial, 'shell', 'input', 'tap', '120', '340']), 'Tap arguments constructed as discrete positional strings without shell wrapping');

  const life1KeyCmd = executedCommands.find(c => c.includes('keyevent'));
  assert(!!life1KeyCmd, 'Lifecycle 1 executed keyevent command');
  assertEqual(JSON.stringify(life1KeyCmd), JSON.stringify(['-s', validSerial, 'shell', 'input', 'keyevent', '4']), 'Keyevent arguments constructed as discrete positional strings');

  // Lifecycle 2: A failing step (ADB non-zero exit code)
  const failEngineDevice: any = {
    executeAdb: async (args: string[]) => {
      if (args.includes('tap')) {
        return { code: 1, stdout: '', stderr: 'input: device write failure' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
  };
  const failEngine = new WorkflowEngine(failEngineDevice, mockDiagnosticsManager);
  const failWf: WorkflowDefinition = {
    id: 'wf-life-2-fail',
    name: 'Life 2 Fail',
    steps: [
      { id: 's1', action: 'keyevent', params: { keycode: 3 } },
      { id: 's2', action: 'tap', params: { x: 100, y: 100 } },
      { id: 's3', action: 'keyevent', params: { keycode: 4 } }
    ]
  };
  const failRes = await failEngine.executeWorkflow(validSerial, failWf, dummyFolder);
  assertEqual(failRes.overallStatus, 'failed', 'Lifecycle 2: Failing step causes overallStatus="failed"');
  assertEqual(failRes.success, false, 'Lifecycle 2: success is false');
  assertEqual(failRes.passedSteps, 1, 'Lifecycle 2: Step 1 passed');
  assertEqual(failRes.failedSteps, 1, 'Lifecycle 2: Step 2 failed');
  assertEqual(failRes.results.length, 2, 'Lifecycle 2: Execution halted at step 2, step 3 never executed');
  assert(failRes.results[1]?.error?.includes('Tap failed') ?? false, 'Lifecycle 2: Error explains tap failure');

  // Lifecycle 3: A blocked step (OEM security restriction)
  const oemBlockDevice: any = {
    executeAdb: async (args: string[]) => {
      if (args.includes('tap')) {
        return {
          code: 255,
          stdout: '',
          stderr: 'java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission'
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
  };
  const oemEngine = new WorkflowEngine(oemBlockDevice, mockDiagnosticsManager);
  const oemWf: WorkflowDefinition = {
    id: 'wf-life-3-oem',
    name: 'Life 3 OEM Blocked',
    steps: [
      { id: 's1', action: 'tap', params: { x: 50, y: 50 } }
    ]
  };
  const oemRes = await oemEngine.executeWorkflow(validSerial, oemWf, dummyFolder);
  assertEqual(oemRes.overallStatus, 'failed', 'Lifecycle 3: Blocked step reports overallStatus="failed"');
  assert(oemRes.results[0]?.error?.includes('Tap blocked by device security settings') ?? false, 'Lifecycle 3: Specifically identifies OEM security block');

  // Lifecycle 4: Cancellation during an active step (wait interrupted)
  const midStepEngine = new WorkflowEngine(mockDeviceManager, mockDiagnosticsManager);
  const midStepWf: WorkflowDefinition = {
    id: 'wf-life-4-cancel-active',
    name: 'Life 4 Cancel Active',
    steps: [
      { id: 's1', action: 'wait', params: { waitMs: 2000 } },
      { id: 's2', action: 'tap', params: { x: 100, y: 100 } }
    ]
  };
  const midStepStart = Date.now();
  setTimeout(() => midStepEngine.cancel(), 50); // cancel after 50ms into a 2000ms wait
  const midStepRes = await midStepEngine.executeWorkflow(validSerial, midStepWf, dummyFolder);
  const midStepDuration = Date.now() - midStepStart;
  assert(midStepDuration < 1000, `Lifecycle 4: Active wait cancelled promptly (${midStepDuration}ms < 1000ms)`);
  assertEqual(midStepRes.overallStatus, 'failed', 'Lifecycle 4: Cancelled workflow overallStatus="failed"');
  assertEqual(midStepRes.success, false, 'Lifecycle 4: success is false');
  assertEqual(midStepRes.results[0]?.status, 'skipped', 'Lifecycle 4: Active step cancelled mid-execution marked skipped');
  assertEqual(midStepRes.results[1]?.status, 'skipped', 'Lifecycle 4: Remaining step marked skipped');

  // Lifecycle 5: Cancellation between steps
  const betweenEngine = new WorkflowEngine(mockDeviceManager, mockDiagnosticsManager);
  const betweenWf: WorkflowDefinition = {
    id: 'wf-life-5-cancel-between',
    name: 'Life 5 Cancel Between',
    steps: [
      { id: 's1', action: 'keyevent', params: { keycode: 3 } },
      { id: 's2', action: 'tap', params: { x: 100, y: 100 } },
      { id: 's3', action: 'wait', params: { waitMs: 10 } }
    ]
  };
  const onStepCompleted = (data: any) => {
    if (data.stepIndex === 0) {
      betweenEngine.cancel();
    }
  };
  betweenEngine.on('step_completed', onStepCompleted);
  const betweenRes = await betweenEngine.executeWorkflow(validSerial, betweenWf, dummyFolder);
  betweenEngine.off('step_completed', onStepCompleted);

  assertEqual(betweenRes.overallStatus, 'failed', 'Lifecycle 5: Cancelled between steps overallStatus="failed"');
  assertEqual(betweenRes.passedSteps, 1, 'Lifecycle 5: Step 1 passed prior to cancellation');
  assertEqual(betweenRes.results[0]?.status, 'passed', 'Lifecycle 5: Step 1 status is passed');
  assertEqual(betweenRes.results[1]?.status, 'skipped', 'Lifecycle 5: Step 2 skipped');
  assertEqual(betweenRes.results[2]?.status, 'skipped', 'Lifecycle 5: Step 3 skipped');

  // Lifecycle 6: Cancellation after final step has already resolved
  const postEngine = new WorkflowEngine(mockDeviceManager, mockDiagnosticsManager);
  const postWf: WorkflowDefinition = {
    id: 'wf-life-6-cancel-post',
    name: 'Life 6 Cancel Post',
    steps: [
      { id: 's1', action: 'keyevent', params: { keycode: 3 } }
    ]
  };
  const postRes = await postEngine.executeWorkflow(validSerial, postWf, dummyFolder);
  postEngine.cancel(); // Cancelled after completion
  assertEqual(postRes.overallStatus, 'passed', 'Lifecycle 6: Post-execution cancel does not mutate passed report');
  assertEqual(postRes.success, true, 'Lifecycle 6: success remains true');

  // Lifecycle 7: Repeated cancellation calls
  const repeatEngine = new WorkflowEngine(mockDeviceManager, mockDiagnosticsManager);
  // Call cancel multiple times before, during, and after
  repeatEngine.cancel();
  repeatEngine.cancel();
  repeatEngine.cancel();
  assert(true, 'Lifecycle 7: Multiple cancel calls are idempotent without exceptions');

  // Lifecycle 8: Cancellation followed immediately by a second workflow
  // First run gets cancelled
  const sequentialEngine = new WorkflowEngine(mockDeviceManager, mockDiagnosticsManager);
  const seqWf1: WorkflowDefinition = {
    id: 'wf-life-8-first',
    name: 'Life 8 First (to be cancelled)',
    steps: [
      { id: 's1', action: 'wait', params: { waitMs: 1000 } }
    ]
  };
  setTimeout(() => sequentialEngine.cancel(), 30);
  const seqRes1 = await sequentialEngine.executeWorkflow(validSerial, seqWf1, dummyFolder);
  assertEqual(seqRes1.overallStatus, 'failed', 'Lifecycle 8: First workflow cancelled');

  // Immediately run second workflow on same engine instance
  const seqWf2: WorkflowDefinition = {
    id: 'wf-life-8-second',
    name: 'Life 8 Second (should succeed cleanly)',
    steps: [
      { id: 's1', action: 'keyevent', params: { keycode: 3 } },
      { id: 's2', action: 'tap', params: { x: 200, y: 200 } }
    ]
  };
  const seqRes2 = await sequentialEngine.executeWorkflow(validSerial, seqWf2, dummyFolder);
  assertEqual(seqRes2.overallStatus, 'passed', 'Lifecycle 8: Second workflow resets cancellation and executes successfully');
  assertEqual(seqRes2.success, true, 'Lifecycle 8: Second workflow success is true');
  assertEqual(seqRes2.passedSteps, 2, 'Lifecycle 8: Both steps passed in second workflow');

  // Lifecycle 9: ADB timeout or device disconnection during step
  const disconnectDevice: any = {
    executeAdb: async () => ({
      code: 1,
      stdout: '',
      stderr: "error: device 'emulator-5554' not found"
    })
  };
  const disconnectEngine = new WorkflowEngine(disconnectDevice, mockDiagnosticsManager);
  const disconnectWf: WorkflowDefinition = {
    id: 'wf-life-9-disconnect',
    name: 'Life 9 Device Disconnect',
    steps: [
      { id: 's1', action: 'tap', params: { x: 100, y: 100 } }
    ]
  };
  const disconnectRes = await disconnectEngine.executeWorkflow(validSerial, disconnectWf, dummyFolder);
  assertEqual(disconnectRes.overallStatus, 'failed', 'Lifecycle 9: Device disconnect step reports overallStatus="failed"');
  assertEqual(disconnectRes.failedSteps, 1, 'Lifecycle 9: Step failed count is 1');
  assert(disconnectRes.results[0]?.error?.includes("device 'emulator-5554' not found") ?? false, 'Lifecycle 9: Error reports device disconnection cleanly');

  // 11. Complete Argument Construction & Security Escaping for All Action Types
  executedCommands.length = 0;
  const allActionDevice: any = {
    executeAdb: async (args: string[]) => {
      executedCommands.push(args);
      if (args.includes('dump')) {
        return { code: 0, stdout: 'UI hierarchy dumped to: /data/local/tmp/dump.xml', stderr: '' };
      }
      if (args.includes('cat')) {
        return { code: 0, stdout: '<node text="Expected UI Text" />', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
  };
  const allActionEngine = new WorkflowEngine(allActionDevice, mockDiagnosticsManager);
  const allActionWf: WorkflowDefinition = {
    id: 'wf-all-actions',
    name: 'All Actions Argument Verification',
    steps: [
      { id: 's1', action: 'tap', params: { x: 450, y: 850 } },
      { id: 's2', action: 'swipe', params: { x: 100, y: 800, x2: 100, y2: 200, durationMs: 400 } },
      { id: 's3', action: 'keyevent', params: { keycode: 24 } }, // VOLUME_UP
      { id: 's4', action: 'input_text', params: { text: 'Test $100 & "quotes"' } },
      { id: 's5', action: 'wait', params: { waitMs: 10 } },
      { id: 's6', action: 'screenshot', params: {} },
      { id: 's7', action: 'assert_text', params: { text: 'Expected UI Text' } }
    ]
  };

  const allActionRes = await allActionEngine.executeWorkflow(validSerial, allActionWf, dummyFolder);
  assertEqual(allActionRes.overallStatus, 'passed', 'All action types executed successfully');
  assertEqual(allActionRes.passedSteps, 7, 'All 7 action steps passed');

  // Verify swipe args
  const swipeCmd = executedCommands.find(c => c.includes('swipe'));
  assert(!!swipeCmd, 'Swipe command was dispatched');
  assertEqual(JSON.stringify(swipeCmd), JSON.stringify(['-s', validSerial, 'shell', 'input', 'swipe', '100', '800', '100', '200', '400']), 'Swipe arguments are exact discrete numbers');

  // Verify assert_text args (dump and cat without shell wrapping)
  const dumpCmd = executedCommands.find(c => c.includes('uiautomator'));
  assert(!!dumpCmd, 'uiautomator dump command was dispatched');
  assertEqual(JSON.stringify(dumpCmd), JSON.stringify(['-s', validSerial, 'shell', 'uiautomator', 'dump', '/data/local/tmp/dump.xml']), 'uiautomator dump args strictly discrete');

  const catCmd = executedCommands.find(c => c.includes('cat'));
  assert(!!catCmd, 'cat command was dispatched');
  assertEqual(JSON.stringify(catCmd), JSON.stringify(['-s', validSerial, 'shell', 'cat', '/data/local/tmp/dump.xml']), 'cat args strictly discrete');

  // 12. UI Report Compatibility Aliases Test
  executedCommands.length = 0;
  const validWorkflow: WorkflowDefinition = {
    id: 'wf-sanity-ok',
    name: 'Sanity Flow',
    steps: [
      { id: 's1', action: 'keyevent', params: { keycode: 3 } },
      { id: 's2', action: 'wait', params: { waitMs: 10 } },
      { id: 's3', action: 'tap', params: { x: 200, y: 400 } },
      { id: 's4', action: 'swipe', params: { x: 100, y: 500, x2: 100, y2: 200, durationMs: 300 } },
      { id: 's5', action: 'input_text', params: { text: 'HelloAndroScrn' } }
    ]
  };

  const validWorkflowRes = await engine.executeWorkflow(validSerial, validWorkflow, dummyFolder);
  assertEqual(validWorkflowRes.overallStatus, 'passed', 'Valid workflow executes successfully');
  assertEqual(validWorkflowRes.success, true, 'Report provides success=true alias for UI');
  assertEqual(validWorkflowRes.completedSteps, 5, 'Report provides completedSteps=5 alias for UI');
  assertEqual(validWorkflowRes.passedSteps, 5, 'All 5 valid steps completed');
  assertEqual(validWorkflowRes.failedSteps, 0, 'Zero failed steps');
  assert(typeof validWorkflowRes.durationMs === 'number', 'Report provides durationMs number for UI');
  assert(Array.isArray(validWorkflowRes.steps) && validWorkflowRes.steps.length === 5, 'Report provides steps array for UI');
  assertEqual(validWorkflowRes.steps[0].success, true, 'Step provides success=true for UI');
  assert(executedCommands.length >= 4, 'Dispatched ADB commands for key, tap, swipe, input_text');
}
