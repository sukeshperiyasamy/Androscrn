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
}

export class WorkflowEngine extends EventEmitter {
  private deviceManager: DeviceManager;
  private diagnosticsManager: DiagnosticsManager;
  private isCancelled = false;

  constructor(deviceManager: DeviceManager, diagnosticsManager: DiagnosticsManager) {
    super();
    this.deviceManager = deviceManager;
    this.diagnosticsManager = diagnosticsManager;
  }

  public cancel(): void {
    this.isCancelled = true;
  }

  /**
   * Executes a complete test automation workflow
   */
  public async executeWorkflow(
    serial: string,
    workflow: WorkflowDefinition,
    outputFolder: string
  ): Promise<WorkflowExecutionReport> {
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
    }

    const endTime = new Date();
    const passedSteps = results.filter(r => r.status === 'passed').length;
    const failedSteps = results.filter(r => r.status === 'failed').length;
    const overallStatus = failedSteps === 0 && !this.isCancelled ? 'passed' : 'failed';

    const report: WorkflowExecutionReport = {
      workflowId: workflow.id,
      workflowName: workflow.name,
      targetSerial: serial,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      totalDurationMs: endTime.getTime() - startTime.getTime(),
      totalSteps: workflow.steps.length,
      passedSteps,
      failedSteps,
      results,
      overallStatus
    };

    this.emit('workflow_completed', report);
    return report;
  }

  private async executeStep(serial: string, step: WorkflowStep, outputFolder: string, result: StepExecutionResult): Promise<void> {
    if (!SecurityValidator.isValidSerial(serial)) {
      throw new Error('Invalid target device serial.');
    }

    switch (step.action) {
      case 'tap': {
        const x = step.params.x ?? 500;
        const y = step.params.y ?? 500;
        const res = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'input', 'tap', x.toString(), y.toString()]);
        if (res.code !== 0) throw new Error(`Tap failed: ${res.stderr}`);
        if (isInputInjectionBlocked(res)) throw new Error(`Tap blocked by device security settings: ${res.stderr.trim()}`);
        break;
      }

      case 'swipe': {
        const x1 = step.params.x ?? 300;
        const y1 = step.params.y ?? 800;
        const x2 = step.params.x2 ?? 300;
        const y2 = step.params.y2 ?? 200;
        const duration = step.params.durationMs ?? 300;
        const res = await this.deviceManager.executeAdb([
          '-s', serial, 'shell', 'input', 'swipe',
          x1.toString(), y1.toString(), x2.toString(), y2.toString(), duration.toString()
        ]);
        if (res.code !== 0) throw new Error(`Swipe failed: ${res.stderr}`);
        if (isInputInjectionBlocked(res)) throw new Error(`Swipe blocked by device security settings: ${res.stderr.trim()}`);
        break;
      }

      case 'keyevent': {
        const code = step.params.keycode ?? 3; // 3 = HOME
        const res = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'input', 'keyevent', code.toString()]);
        if (res.code !== 0) throw new Error(`Keyevent failed: ${res.stderr}`);
        if (isInputInjectionBlocked(res)) throw new Error(`Keyevent blocked by device security settings: ${res.stderr.trim()}`);
        break;
      }

      case 'input_text': {
        const text = step.params.text ?? '';
        // Escape spaces for Android shell input
        const escaped = text.replace(/\s/g, '%s').replace(/[^a-zA-Z0-9%._-]/g, '');
        const res = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'input', 'text', escaped]);
        if (res.code !== 0) throw new Error(`Text input failed: ${res.stderr}`);
        if (isInputInjectionBlocked(res)) throw new Error(`Text input blocked by device security settings: ${res.stderr.trim()}`);
        break;
      }

      case 'wait': {
        const ms = step.params.waitMs ?? 1000;
        await new Promise(r => setTimeout(r, ms));
        break;
      }

      case 'screenshot': {
        const shot = await this.diagnosticsManager.captureDeviceScreenshot(serial, outputFolder);
        if (!shot.success) throw new Error(shot.error || 'Screenshot failed');
        result.screenshotPath = shot.filePath;
        break;
      }

      case 'assert_text': {
        // UI Hierarchy XML dump probe
        const dumpRes = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'uiautomator', 'dump', '/data/local/tmp/dump.xml']);
        const readRes = await this.deviceManager.executeAdb(['-s', serial, 'shell', 'cat', '/data/local/tmp/dump.xml']);
        const expected = step.params.text || '';
        if (!readRes.stdout.toLowerCase().includes(expected.toLowerCase())) {
          throw new Error(`Text assertion failed: "${expected}" was not found in current UI state.`);
        }
        break;
      }

      default:
        throw new Error(`Unknown workflow action: ${step.action}`);
    }
  }
}
