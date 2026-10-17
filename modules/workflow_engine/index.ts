import { EventEmitter } from 'events';
import { isInputInjectionBlocked } from '../oem_guidance';
import { DeviceManager } from '../device_manager';
import { DiagnosticsManager } from '../diagnostics';
import { SecurityValidator } from '../security';

export type WorkflowActionType =
  | 'tap'
  | 'swipe'
  | 'keyevent'
  | 'input_text'
  | 'wait'
  | 'screenshot'
  | 'assert_text';

export interface WorkflowStep {
  id: string;
  action: WorkflowActionType;
  params: {
    x?: number;
    y?: number;
    x2?: number;
    y2?: number;
    durationMs?: number;
    keycode?: number | string;
    text?: string;
    waitMs?: number;
    label?: string;
  };
  description?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface StepExecutionResult {
  stepId: string;
  action: WorkflowActionType;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
  screenshotPath?: string;
}

export interface WorkflowExecutionReport {
  workflowId: string;
  workflowName: string;
  targetSerial: string;
  startTime: string;
  endTime: string;
  totalDurationMs: number;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  results: StepExecutionResult[];
  overallStatus: 'passed' | 'failed';
  // Seamless compatibility aliases for UI and API consumers
  success: boolean;
  durationMs: number;
  completedSteps: number;
  steps: Array<{ stepId: string; action: WorkflowActionType; success: boolean; durationMs: number; error?: string }>;
}

export class WorkflowEngine extends EventEmitter {
  private deviceManager: DeviceManager;
  private diagnosticsManager: DiagnosticsManager;
  private isCancelled = false;
  private currentAbortController: AbortController | null = null;

  constructor(deviceManager: DeviceManager, diagnosticsManager: DiagnosticsManager) {
    super();
    this.deviceManager = deviceManager;
    this.diagnosticsManager = diagnosticsManager;
  }

  public cancel(): void {
    this.isCancelled = true;
    if (this.currentAbortController) {
      try {
        this.currentAbortController.abort();
      } catch {
        // Ignore abort errors
      }
    }
  }

  /**
   * Executes a complete test automation workflow
   */
  public async executeWorkflow(
    serial: string,
    workflow: WorkflowDefinition,
    outputFolder: string
  ): Promise<WorkflowExecutionReport> {
    if (!serial || typeof serial !== 'string' || !SecurityValidator.isValidSerial(serial)) {
      throw new Error(`Invalid target device serial: "${serial}".`);
    }
    if (!workflow || typeof workflow !== 'object') {
      throw new Error('Invalid workflow definition: workflow object is required.');
    }
    if (!workflow.id || typeof workflow.id !== 'string') {
      throw new Error('Invalid workflow definition: "id" must be a non-empty string.');
    }
    if (!workflow.name || typeof workflow.name !== 'string') {
      throw new Error('Invalid workflow definition: "name" must be a non-empty string.');
    }
    if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
      throw new Error('Invalid workflow definition: "steps" must be a non-empty array.');
    }
    if (workflow.steps.length > 1000) {
      throw new Error('Invalid workflow definition: exceeds maximum limit of 1000 steps.');
    }

    const allowedActions: WorkflowActionType[] = ['tap', 'swipe', 'keyevent', 'input_text', 'wait', 'screenshot', 'assert_text'];
    for (let i = 0; i < workflow.steps.length; i++) {
      const s = workflow.steps[i];
      if (!s || typeof s !== 'object') {
        throw new Error(`Invalid workflow step at index ${i}: step must be an object.`);
      }
      if (!s.id || typeof s.id !== 'string') {
        throw new Error(`Invalid workflow step at index ${i}: step "id" is required.`);
      }
      if (!s.action || typeof s.action !== 'string' || !allowedActions.includes(s.action as any)) {
        throw new Error(`Invalid workflow step at index ${i}: unknown or missing action "${s?.action}".`);
      }
      if (!s.params || typeof s.params !== 'object') {
        throw new Error(`Invalid workflow step at index ${i}: "params" object is required.`);
      }
    }

    this.isCancelled = false;
    const startTime = new Date();
    const results: StepExecutionResult[] = [];

    this.emit('workflow_started', { workflowId: workflow.id, name: workflow.name, totalSteps: workflow.steps.length });

    for (let i = 0; i < workflow.steps.length; i++) {
      if (this.isCancelled) {
        for (let j = i; j < workflow.steps.length; j++) {
          results.push({
            stepId: workflow.steps[j].id,
            action: workflow.steps[j].action,
            status: 'skipped',
            durationMs: 0,
            error: 'Workflow was cancelled by user.'
          });
        }
        break;
      }

      const step = workflow.steps[i];
      const stepStart = Date.now();
      this.emit('step_started', { stepIndex: i, step });

      let result: StepExecutionResult = {
        stepId: step.id,
        action: step.action,
        status: 'passed',
        durationMs: 0
      };

      try {
        await this.executeStep(serial, step, outputFolder, result);
      } catch (err: any) {
        result.status = 'failed';
        result.error = err.message;
      }

      result.durationMs = Date.now() - stepStart;
      results.push(result);
      this.emit('step_completed', { stepIndex: i, result });

      if (result.status === 'failed') {
        // Attempt failure screenshot
        try {
          const shot = await this.diagnosticsManager.captureDeviceScreenshot(serial, outputFolder);
          if (shot.success) {
            result.screenshotPath = shot.filePath;
          }
        } catch {
          // Ignore secondary failure
        }
        break;
      }

      if (this.isCancelled || result.status === 'skipped') {
        for (let j = i + 1; j < workflow.steps.length; j++) {
          results.push({
            stepId: workflow.steps[j].id,
            action: workflow.steps[j].action,
            status: 'skipped',
            durationMs: 0,
            error: 'Workflow was cancelled by user.'
          });
        }
        break;
      }
    }

    const endTime = new Date();
    const totalDurationMs = endTime.getTime() - startTime.getTime();
    const passedSteps = results.filter(r => r.status === 'passed').length;
    const failedSteps = results.filter(r => r.status === 'failed').length;
    const overallStatus: 'passed' | 'failed' =
      failedSteps === 0 && !this.isCancelled && results.length === workflow.steps.length && passedSteps === workflow.steps.length
        ? 'passed'
        : 'failed';

    const report: WorkflowExecutionReport = {
      workflowId: workflow.id,
      workflowName: workflow.name,
      targetSerial: serial,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      totalDurationMs,
      totalSteps: workflow.steps.length,
      passedSteps,
      failedSteps,
      results,
      overallStatus,
      success: overallStatus === 'passed',
      durationMs: totalDurationMs,
      completedSteps: passedSteps,
      steps: results.map(r => ({
        stepId: r.stepId,
        action: r.action,
        success: r.status === 'passed',
        durationMs: r.durationMs,
        error: r.error
      }))
    };

    this.emit('workflow_completed', report);
    return report;
  }

  private async runAdbWithAbort(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number; aborted?: boolean }> {
    const ac = new AbortController();
    this.currentAbortController = ac;
    try {
      if (this.isCancelled) {
        return { stdout: '', stderr: 'Workflow was cancelled by user.', code: -1, aborted: true };
      }
      return await this.deviceManager.executeAdb(args, timeoutMs, ac.signal);
    } finally {
      if (this.currentAbortController === ac) {
        this.currentAbortController = null;
      }
    }
  }

  private async executeStep(serial: string, step: WorkflowStep, outputFolder: string, result: StepExecutionResult): Promise<void> {
    if (!SecurityValidator.isValidSerial(serial)) {
      throw new Error('Invalid target device serial.');
    }

    switch (step.action) {
      case 'tap': {
        const x = step.params.x ?? 500;
        const y = step.params.y ?? 500;
        if (!SecurityValidator.isValidCoordinate(x, 20000) || !SecurityValidator.isValidCoordinate(y, 20000)) {
          throw new Error(`Invalid tap coordinates: (${x}, ${y}). Coordinates must be non-negative integers <= 20000.`);
        }
        const res = await this.runAdbWithAbort(['-s', serial, 'shell', 'input', 'tap', x.toString(), y.toString()], 10000);
        if (res.aborted || this.isCancelled) {
          result.status = 'skipped';
          result.error = 'Workflow was cancelled by user.';
          return;
        }
        if (isInputInjectionBlocked(res)) throw new Error(`Tap blocked by device security settings: ${res.stderr.trim() || res.stdout.trim()}`);
        if (res.code !== 0) throw new Error(`Tap failed: ${res.stderr || `Exit code ${res.code}`}`);
        break;
      }

      case 'swipe': {
        const x1 = step.params.x ?? 300;
        const y1 = step.params.y ?? 800;
        const x2 = step.params.x2 ?? 300;
        const y2 = step.params.y2 ?? 200;
        const duration = step.params.durationMs ?? 300;
        if (
          !SecurityValidator.isValidCoordinate(x1, 20000) ||
          !SecurityValidator.isValidCoordinate(y1, 20000) ||
          !SecurityValidator.isValidCoordinate(x2, 20000) ||
          !SecurityValidator.isValidCoordinate(y2, 20000)
        ) {
          throw new Error(`Invalid swipe coordinates: (${x1}, ${y1}) -> (${x2}, ${y2}). Coordinates must be non-negative integers <= 20000.`);
        }
        if (!SecurityValidator.isValidSwipeDuration(duration)) {
          throw new Error(`Invalid swipe duration: ${duration}ms (must be between 50 and 10000ms).`);
        }
        const res = await this.runAdbWithAbort([
          '-s', serial, 'shell', 'input', 'swipe',
          x1.toString(), y1.toString(), x2.toString(), y2.toString(), duration.toString()
        ], 15000);
        if (res.aborted || this.isCancelled) {
          result.status = 'skipped';
          result.error = 'Workflow was cancelled by user.';
          return;
        }
        if (isInputInjectionBlocked(res)) throw new Error(`Swipe blocked by device security settings: ${res.stderr.trim() || res.stdout.trim()}`);
        if (res.code !== 0) throw new Error(`Swipe failed: ${res.stderr || `Exit code ${res.code}`}`);
        break;
      }

      case 'keyevent': {
        const code = step.params.keycode ?? 3; // 3 = HOME
        const numCode = typeof code === 'number' ? code : parseInt(String(code), 10);
        if (!SecurityValidator.isValidKeyCode(numCode)) {
          throw new Error(`Invalid keycode: ${code}. Keycode must be an integer between 0 and 300.`);
        }
        const res = await this.runAdbWithAbort(['-s', serial, 'shell', 'input', 'keyevent', numCode.toString()], 10000);
        if (res.aborted || this.isCancelled) {
          result.status = 'skipped';
          result.error = 'Workflow was cancelled by user.';
          return;
        }
        if (isInputInjectionBlocked(res)) throw new Error(`Keyevent blocked by device security settings: ${res.stderr.trim() || res.stdout.trim()}`);
        if (res.code !== 0) throw new Error(`Keyevent failed: ${res.stderr || `Exit code ${res.code}`}`);
        break;
      }

      case 'input_text': {
        const text = step.params.text ?? '';
        const sanitized = SecurityValidator.sanitizeInputText(text, { allowPunctuation: true });
        if (!sanitized.valid || !sanitized.encoded) {
          throw new Error(`Input text validation failed: ${sanitized.error || 'Invalid text.'}`);
        }
        const res = await this.runAdbWithAbort(['-s', serial, 'shell', 'input', 'text', sanitized.encoded], 15000);
        if (res.aborted || this.isCancelled) {
          result.status = 'skipped';
          result.error = 'Workflow was cancelled by user.';
          return;
        }
        if (isInputInjectionBlocked(res)) throw new Error(`Text input blocked by device security settings: ${res.stderr.trim() || res.stdout.trim()}`);
        if (res.code !== 0) throw new Error(`Text input failed: ${res.stderr || `Exit code ${res.code}`}`);
        break;
      }

      case 'wait': {
        const ms = step.params.waitMs ?? 1000;
        if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > 60000) {
          throw new Error(`Invalid wait duration: ${ms}ms (must be an integer between 0 and 60000ms).`);
        }
        const interval = 25;
        let elapsed = 0;
        while (elapsed < ms && !this.isCancelled) {
          const chunk = Math.min(interval, ms - elapsed);
          await new Promise(r => setTimeout(r, chunk));
          elapsed += chunk;
        }
        if (this.isCancelled) {
          result.status = 'skipped';
          result.error = 'Workflow was cancelled by user.';
          return;
        }
        break;
      }

      case 'screenshot': {
        const shot = await this.diagnosticsManager.captureDeviceScreenshot(serial, outputFolder);
        if (!shot.success) throw new Error(shot.error || 'Screenshot failed');
        result.screenshotPath = shot.filePath;
        break;
      }

      case 'assert_text': {
        const expected = step.params.text;
        if (typeof expected !== 'string' || expected.length === 0) {
          throw new Error('assert_text step requires a non-empty string "text" parameter.');
        }
        // UI Hierarchy XML dump probe
        const dumpRes = await this.runAdbWithAbort(['-s', serial, 'shell', 'uiautomator', 'dump', '/data/local/tmp/dump.xml'], 15000);
        if (dumpRes.aborted || this.isCancelled) {
          result.status = 'skipped';
          result.error = 'Workflow was cancelled by user.';
          return;
        }
        if (dumpRes.code !== 0) {
          throw new Error(`UI automator dump failed: ${dumpRes.stderr.trim() || dumpRes.stdout.trim() || 'Command failed'}`);
        }
        const readRes = await this.runAdbWithAbort(['-s', serial, 'shell', 'cat', '/data/local/tmp/dump.xml'], 10000);
        if (readRes.aborted || this.isCancelled) {
          result.status = 'skipped';
          result.error = 'Workflow was cancelled by user.';
          return;
        }
        if (readRes.code !== 0) {
          throw new Error(`Failed to read UI hierarchy dump: ${readRes.stderr.trim() || 'File unreadable'}`);
        }
        if (!readRes.stdout.toLowerCase().includes(expected.toLowerCase())) {
          throw new Error(`Text assertion failed: "${expected}" was not found in current UI state.`);
        }
        break;
      }

      default:
        throw new Error(`Unknown workflow action: "${(step as any).action}".`);
    }
  }
}
