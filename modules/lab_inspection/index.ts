import path from 'path';
import fs from 'fs';

export type OverlayType = 'none' | 'grid_thirds' | 'grid_fine' | 'crosshair' | 'reticle' | 'diagonal';

export interface OverlayConfig {
  type: OverlayType;
  color: string; // e.g. '#38bdf8'
  opacity: number; // 0.1 to 1.0
  lineWidth?: number;
  showTimestamp: boolean;
  showCoordinates: boolean;
  customLabel?: string;
}

export type ComparisonMode = 'side_by_side' | 'split_vertical' | 'split_horizontal' | 'overlay_blend';

export interface ReferenceComparisonConfig {
  enabled: boolean;
  referenceImagePath?: string;
  referenceImageName?: string;
  mode: ComparisonMode;
  splitPosition: number; // 0 - 100 percentage
  blendOpacity: number; // 0.0 - 1.0
}

export interface SnapshotMetadata {
  timestamp: string;
  isoDate: string;
  deviceId: string;
  sensorId: string;
  lensFacing: 'back' | 'front' | 'unknown';
  zoomLevel: number;
  overlayType: OverlayType;
  imageWidth?: number;
  imageHeight?: number;
  isCalibrated: boolean;
  calibrationNote: string;
}

export interface TimelapseConfig {
  intervalSeconds: number; // e.g. 2, 5, 10, 30, 60
  maxFrames: number; // e.g. 30, 60, 120, 300
  outputDir: string;
  prefix?: string;
  metadata?: Partial<SnapshotMetadata>;
}

export interface TimelapseStatus {
  running: boolean;
  paused: boolean;
  currentFrame: number;
  totalFrames: number;
  intervalSeconds: number;
  outputDir: string;
  startTime?: number;
  lastFramePath?: string;
  elapsedSeconds: number;
  error?: string;
}

export interface TimelapseManifest {
  sessionTitle: string;
  createdAt: string;
  intervalSeconds: number;
  totalFrames: number;
  outputDirectory: string;
  frames: Array<{
    frameNumber: number;
    filename: string;
    timestamp: string;
    sizeBytes?: number;
  }>;
}

/**
 * Generates an SVG string representation of the requested inspection overlay.
 * Overlays are rendered on top of the live viewport or exported into annotated copies.
 */
export function generateSvgOverlay(
  width: number,
  height: number,
  config: OverlayConfig,
  metadata?: Partial<SnapshotMetadata>
): string {
  if (config.type === 'none') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
  }

  const color = config.color || '#38bdf8';
  const opacity = Math.max(0.1, Math.min(1.0, config.opacity ?? 0.8));
  const strokeWidth = config.lineWidth || 1.5;
  const elements: string[] = [];

  const cx = width / 2;
  const cy = height / 2;

  // 1. Grid Thirds (Rule of Thirds)
  if (config.type === 'grid_thirds') {
    const x1 = width / 3;
    const x2 = (width * 2) / 3;
    const y1 = height / 3;
    const y2 = (height * 2) / 3;

    elements.push(
      `<line x1="${x1}" y1="0" x2="${x1}" y2="${height}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="${x2}" y1="0" x2="${x2}" y2="${height}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="0" y1="${y1}" x2="${width}" y2="${y1}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="0" y1="${y2}" x2="${width}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      // Intersection focal points
      `<circle cx="${x1}" cy="${y1}" r="4" fill="${color}" fill-opacity="${opacity}" />`,
      `<circle cx="${x2}" cy="${y1}" r="4" fill="${color}" fill-opacity="${opacity}" />`,
      `<circle cx="${x1}" cy="${y2}" r="4" fill="${color}" fill-opacity="${opacity}" />`,
      `<circle cx="${x2}" cy="${y2}" r="4" fill="${color}" fill-opacity="${opacity}" />`
    );
  }

  // 2. Fine Grid (10x10)
  if (config.type === 'grid_fine') {
    const cols = 10;
    const rows = 10;
    for (let i = 1; i < cols; i++) {
      const x = (width * i) / cols;
      elements.push(
        `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${color}" stroke-width="1" stroke-opacity="${opacity * 0.5}" stroke-dasharray="3,3" />`
      );
    }
    for (let j = 1; j < rows; j++) {
      const y = (height * j) / rows;
      elements.push(
        `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${color}" stroke-width="1" stroke-opacity="${opacity * 0.5}" stroke-dasharray="3,3" />`
      );
    }
    // Main Axes
    elements.push(
      `<line x1="${cx}" y1="0" x2="${cx}" y2="${height}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="0" y1="${cy}" x2="${width}" y2="${cy}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`
    );
  }

  // 3. Precision Crosshairs
  if (config.type === 'crosshair') {
    elements.push(
      `<line x1="${cx}" y1="0" x2="${cx}" y2="${height}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="0" y1="${cy}" x2="${width}" y2="${cy}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<circle cx="${cx}" cy="${cy}" r="25" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<circle cx="${cx}" cy="${cy}" r="60" fill="none" stroke="${color}" stroke-width="1" stroke-opacity="${opacity * 0.6}" stroke-dasharray="4,4" />`,
      `<circle cx="${cx}" cy="${cy}" r="120" fill="none" stroke="${color}" stroke-width="1" stroke-opacity="${opacity * 0.4}" stroke-dasharray="4,4" />`,
      `<circle cx="${cx}" cy="${cy}" r="3" fill="${color}" fill-opacity="${opacity}" />`
    );
  }

  // 4. Inspection Reticle
  if (config.type === 'reticle') {
    elements.push(
      `<circle cx="${cx}" cy="${cy}" r="40" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<circle cx="${cx}" cy="${cy}" r="90" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<circle cx="${cx}" cy="${cy}" r="160" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity * 0.7}" />`,
      // Precision tick marks along axes
      `<line x1="${cx - 160}" y1="${cy}" x2="${cx - 40}" y2="${cy}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="${cx + 40}" y1="${cy}" x2="${cx + 160}" y2="${cy}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="${cx}" y1="${cy - 160}" x2="${cx}" y2="${cy - 40}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="${cx}" y1="${cy + 40}" x2="${cx}" y2="${cy + 160}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${color}" fill-opacity="${opacity}" />`
    );
  }

  // 5. Diagonal / Golden Triangle
  if (config.type === 'diagonal') {
    elements.push(
      `<line x1="0" y1="0" x2="${width}" y2="${height}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`,
      `<line x1="${width}" y1="0" x2="0" y2="${height}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" />`
    );
  }

  // Corner Bounding Frame
  const cornerLen = 20;
  elements.push(
    // Top-Left
    `<path d="M 10 ${10 + cornerLen} L 10 10 L ${10 + cornerLen} 10" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="${opacity}" />`,
    // Top-Right
    `<path d="M ${width - 10 - cornerLen} 10 L ${width - 10} 10 L ${width - 10} ${10 + cornerLen}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="${opacity}" />`,
    // Bottom-Left
    `<path d="M 10 ${height - 10 - cornerLen} L 10 ${height - 10} L ${10 + cornerLen} ${height - 10}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="${opacity}" />`,
    // Bottom-Right
    `<path d="M ${width - 10 - cornerLen} ${height - 10} L ${width - 10} ${height - 10} L ${width - 10} ${height - 10 - cornerLen}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="${opacity}" />`
  );

  // Optional Timestamp & Watermark Header
  if (config.showTimestamp) {
    const timeText = metadata?.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19);
    elements.push(
      `<rect x="16" y="16" width="220" height="24" rx="4" fill="#07090e" fill-opacity="0.85" />`,
      `<text x="24" y="32" font-family="monospace" font-size="11" font-weight="bold" fill="${color}">UTC: ${timeText}</text>`
    );
  }

  // Optional Pixel Coordinates Indicator
  if (config.showCoordinates) {
    const dimText = `${width}x${height} px [Relative Uncalibrated]`;
    elements.push(
      `<rect x="${width - 240}" y="${height - 36}" width="224" height="22" rx="4" fill="#07090e" fill-opacity="0.85" />`,
      `<text x="${width - 230}" y="${height - 21}" font-family="monospace" font-size="10" fill="#94a3b8">${dimText}</text>`
    );
  }

  // Optional Custom Label
  if (config.customLabel) {
    elements.push(
      `<rect x="${width / 2 - 80}" y="16" width="160" height="24" rx="4" fill="#07090e" fill-opacity="0.85" />`,
      `<text x="${width / 2}" y="32" font-family="sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">${config.customLabel}</text>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${elements.join('\n')}
</svg>`;
}

/**
 * Creates a structured snapshot metadata descriptor.
 */
export function createSnapshotMetadata(
  options: Partial<SnapshotMetadata> & { deviceId: string; sensorId: string }
): SnapshotMetadata {
  const now = new Date();
  return {
    timestamp: now.toISOString().replace('T', ' ').substring(0, 19),
    isoDate: now.toISOString(),
    deviceId: options.deviceId,
    sensorId: options.sensorId,
    lensFacing: options.lensFacing || 'back',
    zoomLevel: options.zoomLevel ?? 1.0,
    overlayType: options.overlayType || 'none',
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
    isCalibrated: false,
    calibrationNote: 'Coordinates and distances are in uncalibrated sensor pixels. Optical calibration target required for physical metric units.'
  };
}

/**
 * Manages scheduled timelapse captures at user-defined intervals with safety limits.
 */
export class TimelapseScheduler {
  private timer: NodeJS.Timeout | null = null;
  private status: TimelapseStatus = {
    running: false,
    paused: false,
    currentFrame: 0,
    totalFrames: 0,
    intervalSeconds: 5,
    outputDir: '',
    elapsedSeconds: 0
  };
  private manifest: TimelapseManifest | null = null;

  constructor() {}

  public getStatus(): TimelapseStatus {
    if (this.status.running && this.status.startTime) {
      this.status.elapsedSeconds = Math.round((Date.now() - this.status.startTime) / 1000);
    }
    return { ...this.status };
  }

  public async start(
    config: TimelapseConfig,
    captureFrameCallback: (frameNum: number) => Promise<string>
  ): Promise<{ success: boolean; message?: string }> {
    if (this.status.running) {
      return { success: false, message: 'Timelapse session is already running' };
    }

    if (config.intervalSeconds < 1) {
      return { success: false, message: 'Interval must be at least 1 second' };
    }

    if (config.maxFrames < 1 || config.maxFrames > 3600) {
      return { success: false, message: 'Total frames must be between 1 and 3600' };
    }

    if (!fs.existsSync(config.outputDir)) {
      fs.mkdirSync(config.outputDir, { recursive: true });
    }

    this.status = {
      running: true,
      paused: false,
      currentFrame: 0,
      totalFrames: config.maxFrames,
      intervalSeconds: config.intervalSeconds,
      outputDir: config.outputDir,
      startTime: Date.now(),
      elapsedSeconds: 0
    };

    this.manifest = {
      sessionTitle: `Timelapse_${Date.now()}`,
      createdAt: new Date().toISOString(),
      intervalSeconds: config.intervalSeconds,
      totalFrames: config.maxFrames,
      outputDirectory: config.outputDir,
      frames: []
    };

    // Capture initial frame immediately
    await this.captureStep(captureFrameCallback);

    // Schedule subsequent frames
    this.timer = setInterval(async () => {
      if (!this.status.running || this.status.paused) return;

      if (this.status.currentFrame >= this.status.totalFrames) {
        this.stop();
        return;
      }

      await this.captureStep(captureFrameCallback);
    }, config.intervalSeconds * 1000);

    return { success: true };
  }

  private async captureStep(captureFrameCallback: (frameNum: number) => Promise<string>): Promise<void> {
    try {
      this.status.currentFrame++;
      const framePath = await captureFrameCallback(this.status.currentFrame);
      this.status.lastFramePath = framePath;

      let sizeBytes = 0;
      if (fs.existsSync(framePath)) {
        sizeBytes = fs.statSync(framePath).size;
      }

      this.manifest?.frames.push({
        frameNumber: this.status.currentFrame,
        filename: path.basename(framePath),
        timestamp: new Date().toISOString(),
        sizeBytes
      });

      if (this.status.currentFrame >= this.status.totalFrames) {
        this.stop();
      }
    } catch (err: any) {
      this.status.error = err?.message || 'Capture step failed';
      this.stop();
    }
  }

  public stop(): TimelapseStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.running = false;

    // Save manifest JSON to destination directory
    if (this.manifest && fs.existsSync(this.status.outputDir)) {
      try {
        const manifestPath = path.join(this.status.outputDir, 'timelapse_manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(this.manifest, null, 2), 'utf8');
      } catch {
        // ignore
      }
    }

    return this.getStatus();
  }
}
