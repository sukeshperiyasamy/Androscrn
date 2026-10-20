import React, { useEffect, useRef, useState } from 'react';
import { FileText, ScanLine, RotateCcw, RotateCw, XCircle, Copy, Save, FileDown, Crop, Check, Undo } from 'lucide-react';
import {
  Point,
  Quad,
  CORNER_NAMES,
  rotateQuadQuarterTurns,
  validateCornerGeometry
} from './corner-utils';

interface Preview {
  dataUrl: string;
  width: number;
  height: number;
  scale: number;
}

interface OcrSummary {
  text: string;
  rawText: string;
  meanConfidence: number | null;
  wordCount: number;
  lowConfidenceWords: number;
  lowConfidenceSample: Array<{ text: string; confidence: number }>;
  engine: string;
  language: string;
  durationMs: number;
}

interface CaptureItem {
  name: string;
  type: string;
  path: string;
}

interface Props {
  api: any;
  selectedSerial: string;
  deviceReady: boolean;
  captures: CaptureItem[];
}

const ERROR_HINTS: Record<string, string> = {
  UNSUPPORTED_FORMAT: 'Use a PNG or JPEG image.',
  IMAGE_TOO_LARGE: 'Try a smaller or lower-resolution image.',
  CORRUPT_IMAGE: 'The file may be damaged. Try exporting the image again.',
  OCR_UNAVAILABLE: 'Text recognition is not available on this installation.',
  OCR_FAILED: 'Try again, or enhance the image first.',
  TIMEOUT: 'Recognition took too long. Try a smaller image.',
  NOT_FOUND: 'Import the image again.',
  WRITE_FAILED: 'Check that Captures/documents is writable and the disk is not full.'
};

export default function DocumentPanel({ api, selectedSerial, deviceReady, captures }: Props) {
  const [ocrStatus, setOcrStatus] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [docName, setDocName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [corners, setCorners] = useState<Quad | null>(null);
  const [detectedCorners, setDetectedCorners] = useState<Quad | null>(null);
  const [isAdjustingCorners, setIsAdjustingCorners] = useState(false);
  const [draftCorners, setDraftCorners] = useState<Quad | null>(null);
  const [activeCornerIndex, setActiveCornerIndex] = useState<number | null>(null);
  const [cornerGeometryError, setCornerGeometryError] = useState<string | null>(null);
  const [detectionNote, setDetectionNote] = useState('');
  const [skew, setSkew] = useState(0);
  const [cropToPage, setCropToPage] = useState(true);
  const [turns, setTurns] = useState(0);
  const [fine, setFine] = useState(0);
  const [enhance, setEnhance] = useState(true);
  const [busy, setBusy] = useState<null | 'import' | 'process' | 'ocr'>(null);
  const [progress, setProgress] = useState<{ stage: string; value: number } | null>(null);
  const [result, setResult] = useState<OcrSummary | null>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ kind: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [savedDir, setSavedDir] = useState<string | null>(null);
  const [captureChoice, setCaptureChoice] = useState('');
  const currentId = useRef<string | null>(null);
  currentId.current = docId;
  const svgRef = useRef<SVGSVGElement | null>(null);

  const imageCaptures = captures.filter(c => /\.(png|jpe?g)$/i.test(c.name));

  useEffect(() => {
    let cancelled = false;
    api?.documentOcrStatus?.().then((s: any) => { if (!cancelled) setOcrStatus(s); }).catch(() => { if (!cancelled) setOcrStatus(null); });
    const off = api?.onDocumentOcrProgress?.((p: any) => {
      if (p.id === currentId.current) setProgress({ stage: p.stage, value: p.progress });
    });
    return () => {
      cancelled = true;
      if (typeof off === 'function') off();
    };
  }, []);

  const fail = (res: any) => {
    const hint = ERROR_HINTS[res?.code] ? ` ${ERROR_HINTS[res.code]}` : '';
    if (res?.code === 'CANCELLED') setMessage({ kind: 'info', text: 'Cancelled.' });
    else setMessage({ kind: 'error', text: `${res?.message || 'Something went wrong.'}${hint}` });
  };

  const applyImport = async (res: any) => {
    if (!res?.ok) {
      if (res?.code !== 'CANCELLED') fail(res);
      return;
    }
    if (docId) api?.documentRelease?.(docId);
    setDocId(res.document.id);
    setDocName(res.document.sourceName);
    setPreview(res.preview);
    const initialCorners: Quad | null = res.corners ? (res.corners as Quad) : null;
    setCorners(initialCorners);
    setDetectedCorners(initialCorners);
    setIsAdjustingCorners(false);
    setDraftCorners(null);
    setCornerGeometryError(null);
    const w = res.document.width || Math.round(res.preview.width / res.preview.scale);
    const h = res.document.height || Math.round(res.preview.height / res.preview.scale);
    setImageDimensions({ width: w, height: h });
    setSkew(Math.round((res.skewDegrees || 0) * 10) / 10);
    setCropToPage(!!res.corners);
    setTurns(0);
    setFine(0);
    setResult(null);
    setText('');
    setSavedDir(null);
    setDetectionNote(
      res.corners
        ? `Page edges detected (${Math.round((res.detectionConfidence || 0) * 100)}% rectangular). Check or adjust the outline before running OCR.`
        : res.detectionReason === 'document-fills-frame'
        ? 'The page fills the whole image, so no cropping is needed.'
        : res.detectionReason === 'low-contrast'
        ? 'Not enough contrast to find the page edges. You can adjust corners manually.'
        : 'No page edges were found. You can adjust corners manually.'
    );
    setMessage({ kind: 'success', text: `Imported ${res.document.sourceName}. The original file is never modified.` });
  };

  const chooseImage = async () => {
    if (!api?.documentImportDialog) return;
    setBusy('import');
    setMessage(null);
    try {
      await applyImport(await api.documentImportDialog());
    } finally {
      setBusy(null);
    }
  };

  const importCapture = async (fileName: string) => {
    if (!fileName || !api?.documentImportCapture) return;
    setBusy('import');
    setMessage(null);
    try {
      await applyImport(await api.documentImportCapture(fileName));
    } finally {
      setBusy(null);
    }
  };

  const captureScreen = async () => {
    if (!api?.captureScreenshot || !selectedSerial) return;
    setBusy('import');
    setMessage({ kind: 'info', text: 'Capturing the phone screen…' });
    try {
      const shot = await api.captureScreenshot(selectedSerial);
      if (!shot?.success || !shot.filePath) {
        setMessage({ kind: 'error', text: shot?.error || 'Screenshot capture failed.' });
        return;
      }
      const name = String(shot.filePath).split(/[\\/]/).pop() as string;
      await applyImport(await api.documentImportCapture(name));
    } finally {
      setBusy(null);
    }
  };

  const applyProcessing = async () => {
    if (!docId || !api?.documentProcess) return;
    setBusy('process');
    setMessage(null);
    try {
      const res = await api.documentProcess({
        id: docId,
        corners: cropToPage && corners ? corners : null,
        rotationQuarterTurns: turns,
        rotationDegrees: fine,
        enhance
      });
      if (res.ok) {
        setPreview(res.preview);
        setCorners(null);
        setDetectedCorners(null);
        setIsAdjustingCorners(false);
        setDraftCorners(null);
        setCornerGeometryError(null);
        if (res.document) {
          setImageDimensions({ width: res.document.width, height: res.document.height });
        }
        setCropToPage(false);
        setResult(null);
        setText('');
        setMessage({ kind: 'success', text: 'Adjustments applied to a processed copy. The original is untouched.' });
      } else fail(res);
    } finally {
      setBusy(null);
    }
  };

  const startCornerAdjustment = () => {
    if (!preview || !imageDimensions) return;
    const initialCorners: Quad = corners
      ? ([...corners] as Quad)
      : detectedCorners
      ? ([...detectedCorners] as Quad)
      : [
          { x: 0, y: 0 },
          { x: imageDimensions.width - 1, y: 0 },
          { x: imageDimensions.width - 1, y: imageDimensions.height - 1 },
          { x: 0, y: imageDimensions.height - 1 }
        ];
    setDraftCorners(initialCorners);
    const val = validateCornerGeometry(initialCorners, imageDimensions.width, imageDimensions.height);
    setCornerGeometryError(val.valid ? null : val.reason || 'Invalid corner geometry.');
    setIsAdjustingCorners(true);
    setMessage({
      kind: 'info',
      text: 'Adjust corners using mouse/touch dragging or keyboard arrow keys (Shift for 10px).'
    });
  };

  const cancelCornerAdjustment = () => {
    setIsAdjustingCorners(false);
    setDraftCorners(null);
    setActiveCornerIndex(null);
    setCornerGeometryError(null);
    setMessage({ kind: 'info', text: 'Corner adjustment cancelled. Previous boundary preserved.' });
  };

  const resetDraftToDetected = () => {
    if (!imageDimensions) return;
    const target: Quad = detectedCorners
      ? ([...detectedCorners] as Quad)
      : [
          { x: 0, y: 0 },
          { x: imageDimensions.width - 1, y: 0 },
          { x: imageDimensions.width - 1, y: imageDimensions.height - 1 },
          { x: 0, y: imageDimensions.height - 1 }
        ];
    setDraftCorners(target);
    const val = validateCornerGeometry(target, imageDimensions.width, imageDimensions.height);
    setCornerGeometryError(val.valid ? null : val.reason || null);
  };

  const rotateDraftCorners = () => {
    if (!draftCorners || !imageDimensions) return;
    const rotated = rotateQuadQuarterTurns(draftCorners, imageDimensions.width, imageDimensions.height, 1);
    setDraftCorners(rotated);
    const val = validateCornerGeometry(rotated, imageDimensions.width, imageDimensions.height);
    setCornerGeometryError(val.valid ? null : val.reason || null);
  };

  const confirmCornerAdjustment = () => {
    if (!draftCorners || !imageDimensions) return;
    const val = validateCornerGeometry(draftCorners, imageDimensions.width, imageDimensions.height);
    if (!val.valid) {
      setCornerGeometryError(val.reason || 'Cannot confirm invalid corner boundary.');
      setMessage({ kind: 'error', text: val.reason || 'Corners must form a valid convex quadrilateral.' });
      return;
    }
    setCorners(draftCorners);
    setCropToPage(true);
    setIsAdjustingCorners(false);
    setDraftCorners(null);
    setActiveCornerIndex(null);
    setCornerGeometryError(null);
    setMessage({
      kind: 'success',
      text: 'Document boundary confirmed. Click "Apply adjustments" to crop and straighten.'
    });
  };

  const updateCornerFromPointer = (index: number, e: React.PointerEvent<SVGElement>) => {
    if (!svgRef.current || !preview || !imageDimensions || !draftCorners) return;
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const svgP = pt.matrixTransform(ctm.inverse());

    const origW = imageDimensions.width;
    const origH = imageDimensions.height;
    const newX = Math.round(Math.max(0, Math.min(origW - 1, svgP.x / preview.scale)));
    const newY = Math.round(Math.max(0, Math.min(origH - 1, svgP.y / preview.scale)));

    const candidate: Quad = [...draftCorners] as Quad;
    candidate[index] = { x: newX, y: newY };
    setDraftCorners(candidate);

    const val = validateCornerGeometry(candidate, origW, origH);
    setCornerGeometryError(val.valid ? null : val.reason || 'Invalid corner geometry.');
  };

  const handleCornerKeyDown = (index: number, e: React.KeyboardEvent<SVGGElement>) => {
    if (!draftCorners || !imageDimensions || !preview) return;
    const step = e.shiftKey ? Math.max(10, Math.round(10 / preview.scale)) : Math.max(1, Math.round(2 / preview.scale));
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;

    e.preventDefault();
    const origW = imageDimensions.width;
    const origH = imageDimensions.height;
    const cur = draftCorners[index];
    const newX = Math.round(Math.max(0, Math.min(origW - 1, cur.x + dx)));
    const newY = Math.round(Math.max(0, Math.min(origH - 1, cur.y + dy)));

    const candidate: Quad = [...draftCorners] as Quad;
    candidate[index] = { x: newX, y: newY };
    setDraftCorners(candidate);

    const val = validateCornerGeometry(candidate, origW, origH);
    setCornerGeometryError(val.valid ? null : val.reason || 'Invalid corner geometry.');
  };

  const runOcr = async () => {
    if (!docId || !api?.documentOcr) return;
    setBusy('ocr');
    setProgress({ stage: 'Starting', value: 0 });
    setMessage(null);
    try {
      const res = await api.documentOcr(docId);
      if (res.ok) {
        setResult(res.result);
        setText(res.result.text);
        setMessage({
          kind: res.result.wordCount === 0 ? 'info' : 'success',
          text: res.result.wordCount === 0 ? 'No text was recognized. Try straightening or enhancing the image.' : `Recognized ${res.result.wordCount} words.`
        });
      } else fail(res);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const cancelOcr = async () => {
    if (docId) await api?.documentOcrCancel?.(docId);
  };

  const persistText = async (value: string) => {
    if (docId) await api?.documentSetText?.(docId, value);
  };

  const save = async () => {
    if (!docId) return;
    await persistText(text);
    const res = await api.documentSave(docId);
    if (res.ok) {
      setSavedDir(res.directory);
      setMessage({ kind: 'success', text: `Saved original copy, processed image, text and manifest to ${res.directory}` });
    } else fail(res);
  };

  const exportPdf = async () => {
    if (!docId) return;
    await persistText(text);
    const res = await api.documentExportPdf(docId);
    if (res.ok) {
      setSavedDir(res.directory);
      const approx = res.insertedWords > 0 ? ` ${res.insertedWords} added word${res.insertedWords === 1 ? '' : 's'} are positioned approximately next to their neighbours.` : '';
      setMessage({ kind: 'success', text: `Searchable PDF saved: ${res.path}. ${res.textSource === 'edited' ? 'The text layer contains your edited text.' : 'The text layer contains the recognized text.'}${approx}` });
    } else fail(res);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ kind: 'success', text: 'Text copied to the clipboard.' });
    } catch {
      setMessage({ kind: 'error', text: 'Copying was blocked. Select the text and copy it manually.' });
    }
  };

  const controlsDisabled = !docId || busy !== null;
  const ocrUnavailable = ocrStatus !== null && !ocrStatus.available;

  return (
    <div className="space-y-4" data-testid="document-panel">
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-2">
          <ScanLine className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
          <h3 className="text-base font-bold text-[#202936]">Document Scanner (local OCR)</h3>
        </div>
        <p className="text-xs text-[#667085] mb-3">
          Import a photo or screenshot of a document, straighten it, and extract the text on this computer. Nothing is uploaded.
          Your original image is never changed; edits are made to a processed copy.
        </p>

        {ocrUnavailable && (
          <div role="alert" className="mb-3 text-xs rounded-xl border border-[#B45309]/30 bg-[#FEF3C7] text-[#B45309] px-3 py-2" data-testid="ocr-unavailable">
            Text recognition is unavailable: {ocrStatus?.reason}. You can still crop and straighten images.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={chooseImage} disabled={busy !== null} className="glass-button glass-button-primary text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer">
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span>Choose image…</span>
          </button>
          <button
            type="button"
            onClick={captureScreen}
            disabled={busy !== null || !deviceReady}
            title={deviceReady ? 'Capture the connected phone screen' : 'Connect and authorize a phone to capture its screen'}
            className="glass-button text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
          >
            <span>Capture phone screen</span>
          </button>
          <label className="sr-only" htmlFor="document-capture-select">Import an existing capture</label>
          <select
            id="document-capture-select"
            value={captureChoice}
            onChange={e => { setCaptureChoice(e.target.value); importCapture(e.target.value); }}
            disabled={busy !== null || imageCaptures.length === 0}
            className="bg-white border border-[#D9DEE5] rounded-xl px-3 py-2 text-xs text-[#202936] max-w-[240px] focus-visible:ring-2 focus-visible:ring-[#0F766E]"
          >
            <option value="">{imageCaptures.length === 0 ? 'No saved captures' : 'Import a saved capture…'}</option>
            {imageCaptures.map(c => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <div role="status" aria-live="polite" className="mt-3 text-xs" data-testid="document-message">
          {message && (
            <span className={message.kind === 'error' ? 'text-[#B91C1C]' : message.kind === 'success' ? 'text-[#15803D]' : 'text-[#0F766E]'}>{message.text}</span>
          )}
        </div>
      </div>

      {preview && (
        <div className="glass-panel p-5" data-testid="document-preview-panel">
          <div className="text-xs font-semibold text-[#202936] mb-2">
            {docName} <span className="text-[#667085] font-normal">· preview</span>
          </div>
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', overflow: 'auto' }} className="rounded-lg border border-[#D9DEE5] bg-slate-950 shadow-xs">
            <img src={preview.dataUrl} alt={`Preview of ${docName}`} width={preview.width} height={preview.height} style={{ display: 'block', maxWidth: '100%', height: 'auto', userSelect: 'none' }} data-testid="document-preview-image" />
            {!isAdjustingCorners && corners && cropToPage && (
              <svg viewBox={`0 0 ${preview.width} ${preview.height}`} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true" data-testid="document-boundary-svg">
                <polygon
                  points={corners.map(c => `${c.x * preview.scale},${c.y * preview.scale}`).join(' ')}
                  fill="rgba(15,118,110,0.15)"
                  stroke="#0F766E"
                  strokeWidth={3}
                />
              </svg>
            )}
            {isAdjustingCorners && draftCorners && (
              <svg
                ref={svgRef}
                viewBox={`0 0 ${preview.width} ${preview.height}`}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', touchAction: 'none' }}
                data-testid="document-corner-editor-svg"
                role="region"
                aria-label="Interactive corner adjustment editor"
              >
                <polygon
                  points={draftCorners.map(c => `${c.x * preview.scale},${c.y * preview.scale}`).join(' ')}
                  fill={cornerGeometryError ? 'rgba(185,28,28,0.18)' : 'rgba(15,118,110,0.18)'}
                  stroke={cornerGeometryError ? '#B91C1C' : '#0F766E'}
                  strokeWidth={3}
                  strokeDasharray={cornerGeometryError ? '6 4' : undefined}
                />
                {draftCorners.map((c, i) => {
                  const cx = c.x * preview.scale;
                  const cy = c.y * preview.scale;
                  const isActive = activeCornerIndex === i;
                  const strokeColor = isActive ? '#0F766E' : cornerGeometryError ? '#B91C1C' : '#0F766E';
                  return (
                    <g
                      key={i}
                      role="slider"
                      tabIndex={0}
                      aria-label={`Corner ${CORNER_NAMES[i]} at ${Math.round(c.x)}, ${Math.round(c.y)}`}
                      aria-valuenow={Math.round(c.x)}
                      data-testid={`corner-handle-${i}`}
                      data-corner={CORNER_NAMES[i]}
                      style={{ outline: 'none', cursor: isActive ? 'grabbing' : 'grab' }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        } catch {}
                        setActiveCornerIndex(i);
                      }}
                      onPointerMove={(e) => {
                        if (activeCornerIndex === i) {
                          e.preventDefault();
                          updateCornerFromPointer(i, e);
                        }
                      }}
                      onPointerUp={(e) => {
                        if (activeCornerIndex === i) {
                          try {
                            (e.currentTarget as Element).releasePointerCapture(e.pointerId);
                          } catch {}
                          setActiveCornerIndex(null);
                        }
                      }}
                      onPointerCancel={() => setActiveCornerIndex(null)}
                      onKeyDown={(e) => handleCornerKeyDown(i, e)}
                    >
                      <circle cx={cx} cy={cy} r={24} fill="transparent" />
                      <circle cx={cx} cy={cy} r={11} fill="#090d16" stroke={strokeColor} strokeWidth={3} />
                      <circle cx={cx} cy={cy} r={3.5} fill="#ffffff" />
                      <text
                        x={cx}
                        y={cy > 24 ? cy - 16 : cy + 24}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize={10}
                        fontWeight="bold"
                        style={{ pointerEvents: 'none', userSelect: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
                      >
                        {CORNER_NAMES[i].split('-').map(w => w[0]).join('')}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {isAdjustingCorners ? (
            <div className="mt-3 space-y-2" data-testid="corner-adjustment-toolbar">
              {cornerGeometryError ? (
                <div role="alert" className="text-xs text-[#B91C1C] bg-[#FEE2E2] border border-[#B91C1C]/40 rounded-lg p-2.5" data-testid="corner-geometry-error">
                  {cornerGeometryError}
                </div>
              ) : (
                <p className="text-[11px] text-[#0F766E] bg-[#DDF4EF] border border-[#0F766E]/30 rounded-lg p-2" data-testid="corner-adjustment-help">
                  Drag any corner handle or select it and use arrow keys (Shift for 10px). Adjust the 4 corners to fit the document boundary.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={rotateDraftCorners}
                  className="glass-button text-xs py-1.5 px-3 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                  data-testid="rotate-corners-button"
                  title="Rotate the boundary 90 degrees clockwise"
                >
                  <RotateCw className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />
                  <span>Rotate boundary 90°</span>
                </button>
                <button
                  type="button"
                  onClick={resetDraftToDetected}
                  disabled={!detectedCorners}
                  className="glass-button text-xs py-1.5 px-3 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer disabled:opacity-50"
                  data-testid="reset-corners-button"
                  title="Reset boundary to the automatically detected page corners"
                >
                  <Undo className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />
                  <span>Reset to detected</span>
                </button>
                <button
                  type="button"
                  onClick={cancelCornerAdjustment}
                  className="glass-button text-xs py-1.5 px-3 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                  data-testid="cancel-corners-button"
                >
                  <span>Cancel</span>
                </button>
                <button
                  type="button"
                  onClick={confirmCornerAdjustment}
                  disabled={Boolean(cornerGeometryError)}
                  className="glass-button glass-button-primary text-xs py-1.5 px-4 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="confirm-corners-button"
                >
                  <Check className="w-4 h-4 mr-1.5 inline" aria-hidden="true" />
                  <span>Confirm boundary</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-[#667085] mt-2" data-testid="document-detection-note">{detectionNote}</p>

              <fieldset className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[#202936]" disabled={controlsDisabled}>
                <legend className="sr-only">Image adjustments</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={cropToPage && !!corners} disabled={!corners} onChange={e => setCropToPage(e.target.checked)} />
                  <span>Crop and straighten to page boundary</span>
                </label>
                <button
                  type="button"
                  onClick={startCornerAdjustment}
                  className="glass-button text-xs py-1.5 px-3 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"
                  data-testid="adjust-corners-button"
                  title="Manually adjust the 4 document corners"
                >
                  <Crop className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />
                  <span>Adjust corners…</span>
                </button>
                <div className="flex items-center gap-2" role="group" aria-label="Rotate">
                  <button type="button" onClick={() => setTurns(t => t - 1)} aria-label="Rotate left 90 degrees" className="glass-button p-2 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"><RotateCcw className="w-4 h-4" aria-hidden="true" /></button>
                  <button type="button" onClick={() => setTurns(t => t + 1)} aria-label="Rotate right 90 degrees" className="glass-button p-2 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"><RotateCw className="w-4 h-4" aria-hidden="true" /></button>
                  <span aria-live="polite">{((turns % 4) + 4) % 4 * 90}°</span>
                </div>
                <label className="flex items-center gap-2">
                  <span>Fine rotation</span>
                  <input type="range" min={-15} max={15} step={0.5} value={fine} onChange={e => setFine(parseFloat(e.target.value))} aria-label="Fine rotation in degrees" />
                  <span className="font-mono w-12">{fine.toFixed(1)}°</span>
                </label>
                {Math.abs(skew) >= 1 && (
                  <button type="button" onClick={() => setFine(Math.max(-15, Math.min(15, -skew)))} className="glass-button text-[11px] py-1 px-3 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer">
                    Suggested straighten ({(-skew).toFixed(1)}°)
                  </button>
                )}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={enhance} onChange={e => setEnhance(e.target.checked)} />
                  <span>Enhance contrast</span>
                </label>
                <button type="button" onClick={applyProcessing} className="glass-button text-xs py-2 px-4 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer">
                  Apply adjustments
                </button>
              </fieldset>
            </>
          )}
        </div>
      )}

      {docId && (
        <div className="glass-panel p-5" data-testid="document-ocr-panel">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={runOcr} disabled={busy !== null || ocrUnavailable} className="glass-button glass-button-primary text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer">
              <span>{busy === 'ocr' ? 'Recognizing…' : 'Run OCR'}</span>
            </button>
            {busy === 'ocr' && (
              <button type="button" onClick={cancelOcr} className="glass-button text-xs py-2 px-4 min-h-[38px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer">
                <XCircle className="w-4 h-4" aria-hidden="true" />
                <span>Cancel</span>
              </button>
            )}
          </div>

          {busy === 'ocr' && progress && (
            <div className="mt-3" data-testid="ocr-progress">
              <div className="text-[11px] text-[#667085] mb-1">{progress.stage}</div>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.value * 100)} aria-label="OCR progress" style={{ height: 8, width: '100%', borderRadius: 4, background: '#D9DEE5', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#0F766E', transition: 'width 150ms', width: `${Math.round(progress.value * 100)}%` }} />
              </div>
            </div>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="ocr-summary">
                <span className="px-2 py-0.5 rounded border border-[#D9DEE5] bg-[#F3F6F8] text-[#202936]">
                  Confidence: {result.meanConfidence === null ? 'not reported' : `${result.meanConfidence}%`}
                </span>
                <span className="text-[#667085]">{result.wordCount} words · {result.lowConfidenceWords} low-confidence · {result.engine} ({result.language}) · {(result.durationMs / 1000).toFixed(1)} s</span>
              </div>
              {result.lowConfidenceSample.length > 0 && (
                <p className="text-[11px] text-[#B45309] bg-[#FEF3C7] p-2 rounded-lg border border-[#B45309]/30" data-testid="low-confidence">
                  Please double-check: {result.lowConfidenceSample.map(w => `${w.text} (${w.confidence}%)`).join(', ')}
                </p>
              )}
              <label htmlFor="document-text" className="block text-xs font-semibold text-[#202936]">Recognized text (editable)</label>
              <textarea
                id="document-text"
                value={text}
                onChange={e => setText(e.target.value)}
                onBlur={() => persistText(text)}
                rows={10}
                style={{ width: '100%' }}
                className="w-full bg-[#F3F6F8] border border-[#D9DEE5] rounded-xl p-3 text-xs font-mono text-[#202936] outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E] focus:bg-white transition-all"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={copyText} className="glass-button text-xs py-2 px-4 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"><Copy className="w-4 h-4" aria-hidden="true" /><span>Copy text</span></button>
                <button type="button" onClick={save} className="glass-button text-xs py-2 px-4 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"><Save className="w-4 h-4" aria-hidden="true" /><span>Save to Captures/documents</span></button>
                <button type="button" onClick={exportPdf} disabled={result.wordCount === 0} className="glass-button text-xs py-2 px-4 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"><FileDown className="w-4 h-4" aria-hidden="true" /><span>Export searchable PDF</span></button>
                {savedDir && api?.openPath && (
                  <button type="button" onClick={() => api.openPath(savedDir)} className="text-xs underline text-[#0F766E] hover:text-[#115E59] focus-visible:ring-2 focus-visible:ring-[#0F766E] cursor-pointer">Open folder</button>
                )}
              </div>
              <p className="text-[11px] text-[#667085]">
                The searchable PDF carries your reviewed text as an invisible layer over the original page image. Unchanged and corrected
                words stay at their recognized positions; words you add are placed approximately next to their neighbours.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
