import React, { useEffect, useRef, useState } from 'react';
import { FileText, ScanLine, RotateCcw, RotateCw, XCircle, Copy, Save, FileDown } from 'lucide-react';

interface Corner {
  x: number;
  y: number;
}

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
  NOT_FOUND: 'Import the image again.'
};

export default function DocumentPanel({ api, selectedSerial, deviceReady, captures }: Props) {
  const [ocrStatus, setOcrStatus] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [docName, setDocName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [corners, setCorners] = useState<Corner[] | null>(null);
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
    setCorners(res.corners);
    setSkew(Math.round((res.skewDegrees || 0) * 10) / 10);
    setCropToPage(!!res.corners);
    setTurns(0);
    setFine(0);
    setResult(null);
    setText('');
    setSavedDir(null);
    setDetectionNote(
      res.corners
        ? `Page edges detected (${Math.round((res.detectionConfidence || 0) * 100)}% rectangular). Check the outline before running OCR.`
        : res.detectionReason === 'document-fills-frame'
        ? 'The page fills the whole image, so no cropping is needed.'
        : res.detectionReason === 'low-contrast'
        ? 'Not enough contrast to find the page edges. The full image will be used.'
        : 'No page edges were found. The full image will be used.'
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
        setCropToPage(false);
        setResult(null);
        setText('');
        setMessage({ kind: 'success', text: 'Adjustments applied to a processed copy. The original is untouched.' });
      } else fail(res);
    } finally {
      setBusy(null);
    }
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
      setMessage({ kind: 'success', text: `Searchable PDF saved: ${res.path}` });
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
          <ScanLine className="w-5 h-5 text-cyan-400" aria-hidden="true" />
          <h3 className="text-base font-bold text-white">Document Scanner (local OCR)</h3>
        </div>
        <p className="text-xs text-slate-300 mb-3">
          Import a photo or screenshot of a document, straighten it, and extract the text on this computer. Nothing is uploaded.
          Your original image is never changed; edits are made to a processed copy.
        </p>

        {ocrUnavailable && (
          <div role="alert" className="mb-3 text-xs rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-100 px-3 py-2" data-testid="ocr-unavailable">
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
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 max-w-[240px] focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <option value="">{imageCaptures.length === 0 ? 'No saved captures' : 'Import a saved capture…'}</option>
            {imageCaptures.map(c => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>

        <div role="status" aria-live="polite" className="mt-3 text-xs" data-testid="document-message">
          {message && (
            <span className={message.kind === 'error' ? 'text-rose-300' : message.kind === 'success' ? 'text-emerald-300' : 'text-indigo-200'}>{message.text}</span>
          )}
        </div>
      </div>

      {preview && (
        <div className="glass-panel p-5" data-testid="document-preview-panel">
          <div className="text-xs font-semibold text-slate-100 mb-2">
            {docName} <span className="text-slate-300 font-normal">· preview</span>
          </div>
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', overflow: 'auto' }} className="rounded-lg border border-slate-700 bg-slate-950">
            <img src={preview.dataUrl} alt={`Preview of ${docName}`} width={preview.width} height={preview.height} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} data-testid="document-preview-image" />
            {corners && cropToPage && (
              <svg viewBox={`0 0 ${preview.width} ${preview.height}`} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true">
                <polygon
                  points={corners.map(c => `${c.x * preview.scale},${c.y * preview.scale}`).join(' ')}
                  fill="rgba(34,211,238,0.12)"
                  stroke="#22d3ee"
                  strokeWidth={3}
                />
              </svg>
            )}
          </div>
          <p className="text-[11px] text-slate-300 mt-2" data-testid="document-detection-note">{detectionNote}</p>

          <fieldset className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-200" disabled={controlsDisabled}>
            <legend className="sr-only">Image adjustments</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={cropToPage && !!corners} disabled={!corners} onChange={e => setCropToPage(e.target.checked)} />
              <span>Crop and straighten to the detected page</span>
            </label>
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
              <div className="text-[11px] text-slate-300 mb-1">{progress.stage}</div>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.value * 100)} aria-label="OCR progress" style={{ height: 8, width: '100%', borderRadius: 4, background: '#1e293b', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#22d3ee', transition: 'width 150ms', width: `${Math.round(progress.value * 100)}%` }} />
              </div>
            </div>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="ocr-summary">
                <span className="px-2 py-0.5 rounded border border-slate-600 text-slate-100">
                  Confidence: {result.meanConfidence === null ? 'not reported' : `${result.meanConfidence}%`}
                </span>
                <span className="text-slate-300">{result.wordCount} words · {result.lowConfidenceWords} low-confidence · {result.engine} ({result.language}) · {(result.durationMs / 1000).toFixed(1)} s</span>
              </div>
              {result.lowConfidenceSample.length > 0 && (
                <p className="text-[11px] text-amber-200" data-testid="low-confidence">
                  Please double-check: {result.lowConfidenceSample.map(w => `${w.text} (${w.confidence}%)`).join(', ')}
                </p>
              )}
              <label htmlFor="document-text" className="block text-xs font-semibold text-slate-100">Recognized text (editable)</label>
              <textarea
                id="document-text"
                value={text}
                onChange={e => setText(e.target.value)}
                onBlur={() => persistText(text)}
                rows={10}
                style={{ width: '100%' }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs font-mono text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={copyText} className="glass-button text-xs py-2 px-4 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"><Copy className="w-4 h-4" aria-hidden="true" /><span>Copy text</span></button>
                <button type="button" onClick={save} className="glass-button text-xs py-2 px-4 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"><Save className="w-4 h-4" aria-hidden="true" /><span>Save to Captures/documents</span></button>
                <button type="button" onClick={exportPdf} disabled={result.wordCount === 0} className="glass-button text-xs py-2 px-4 min-h-[34px] focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer"><FileDown className="w-4 h-4" aria-hidden="true" /><span>Export searchable PDF</span></button>
                {savedDir && api?.openPath && (
                  <button type="button" onClick={() => api.openPath(savedDir)} className="text-xs underline text-cyan-300 focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-pointer">Open folder</button>
                )}
              </div>
              <p className="text-[11px] text-slate-300">
                The searchable PDF contains the recognized words as an invisible text layer. Edits you make above are saved in the text file
                but are not re-embedded in the PDF.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
