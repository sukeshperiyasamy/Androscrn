# Document Intelligence (Local OCR)

The **Documents & OCR** tab turns a photo or screenshot of a document into straightened, editable, searchable text
without sending anything off the computer.

## Workflow

1. **Import** an image: choose a PNG/JPEG file, capture the connected phone's screen, or pick a saved capture.
2. **Review the page outline.** AndroScrn tries to find the edges of a sheet of paper and draws them over the preview.
3. **Adjust** (optional):
   - **Manual corner adjustment:** Click *Adjust corners…* to reposition any of the four corners using mouse/touch dragging or keyboard arrow keys (Shift for 10px). Geometry validation prevents non-convex or self-intersecting quads. Rotate 90°, reset to detected boundary, cancel (leaves original untouched), and confirm boundary are provided.
   - **Straighten & enhance:** Rotate in 90° steps, fine-rotate (the suggested straighten angle is offered when the text is skewed) and enhance contrast.
   - Adjustments create a *processed copy*; perspective correction is applied only after you confirm the boundary and click *Apply adjustments*.
4. **Run OCR.** A progress bar shows the stage; **Cancel** stops it.
5. **Review and edit** the recognized text. The mean confidence, the number of low-confidence words and a list of the
   least certain words are shown so you know what to double-check.
6. **Save or export.** *Save to Captures/documents* writes a folder containing an untouched copy of the original, the
   processed image, the raw OCR result, your (possibly edited) text and a manifest with SHA-256 hashes.
   *Export searchable PDF* writes `searchable.pdf` into the same folder, with your reviewed text as its text layer.

The original image is never modified: it is read once, held in memory, and only ever copied. The manifest records its
hash so you can verify that.

## How it works

| Step | Implementation (`modules/document_intelligence/`) |
| :--- | :--- |
| Decode / encode | `pngjs` and `jpeg-js` (pure JavaScript). JPEG EXIF orientation is applied. Files over 50 MB or 40 megapixels are rejected before decoding. |
| Page detection | Otsu threshold -> largest bright region -> convex hull -> four extreme points. Reports a rectangularity confidence. |
| Corner adjustment | Interactive SVG overlay with 4 accessible handles (`role="slider"`), mouse/touch drag with pointer capture, keyboard navigation, and convex quadrilateral validation. |
| Perspective correction | Homography solved from the four corners, bilinear sampling. Dimension cap at 4000 px prevents memory exhaustion. |
| Rotation / deskew | 90 degree turns, arbitrary angles, projection-profile skew estimate (-15..+15 degrees). |
| OCR | [tesseract.js](https://github.com/naptha/tesseract.js) 7 (WebAssembly) in a worker thread, so recognition never blocks the app window. |
| Searchable PDF | Built-in Type 0 composite font writer (`/Identity-H` encoding + dynamic `/ToUnicode` CMap): processed image as a JPEG page plus an invisible text layer (render mode 3). Preserves all Unicode BMP characters (typographic quotes, accents, currency, CJK). Edited text is aligned to the OCR words first (`align.ts`). |

All OCR files are loaded from disk. The engine is configured with a local `langPath`, no cache files are written, and no
network request is made. Cancellation terminates the worker; a timeout (3 minutes) also terminates it.

## Requirements and distribution size

- **No cloud service, account or API key.** Everything runs locally on Windows 10/11 x64 (the platform AndroScrn
  supports).
- **Language:** English (`eng`) only. Other languages are not bundled and are not offered.
- **Offline Fonts:** Desktop UI uses the native local system font stack (`system-ui, -apple-system, Segoe UI, Roboto, sans-serif`). All external Google Font links and imports have been removed, making the UI 100% network-free at startup.
- **Size:** the portable build is about 148 MB zipped (about 52 MB unpacked) because it carries `tesseract.js`, its WebAssembly core and the English language data (about 3 MB).
- **Licenses:** tesseract.js and tesseract.js-core are Apache-2.0; the English data comes from the Tesseract
  `tessdata_best` set (Apache-2.0); pngjs is MIT; jpeg-js is BSD-3-Clause. See
  [dependencies-and-licenses.md](dependencies-and-licenses.md).
- If the OCR library or language data is missing, the panel shows why and still lets you crop and straighten images.

## What has been verified (and what has not)

Validation reports:
- [OCR sample validation](qa/ocr-sample-validation.md) (`npm run validate:ocr`)
- [Real-photo OCR validation](qa/real-photo-validation.md) (`npm run validate:ocr:real`)
- [PDF export validation](qa/pdf-export-validation.md) (`npm run validate:pdf`)

- **Sample OCR (synthetic):** Three clean, computer-typeset English pages plus deterministic distortions. Character error rate was 0–0.3% on clean text, rising to 3.6% on 6° skew (cured by straighten), and 0.8% under perspective warping. Contrast enhancement showed minimal delta on clean synthetic text.
- **Real-photo OCR validation:** The automated test harness (`tests/validation/real-photo-validation.ts`) measures CER, WER, latency, and preprocessing deltas using a strict normalization policy (collapsing whitespace while strictly preserving punctuation and case). Because no real camera photos are present in the repo, status is recorded as **PENDING** in [qa/real-photo-validation.md](qa/real-photo-validation.md) alongside a step-by-step 7-condition photo collection procedure.
- **Searchable PDF Unicode & visual rendering:** Verified with pdf.js text extraction AND rendered into visual pixels via Chromium canvas. The Type 0 `/Identity-H` font layer correctly preserves quotes (`“ ”`), dashes (`—`), currency (`£, €, ¥`), accents (`café`), and CJK (`漢字`). Word bounding boxes maintain upright alignment in portrait and landscape orientations.
- **Offline UI:** Browser network instrumentation asserts zero remote font requests to Google Fonts or external CDNs on app launch.

## Limitations (read before relying on it)

- **Real-photo accuracy remains pending.** Small synthetic tests do not prove general OCR accuracy on crumpled paper, complex layouts, or varying mobile sensors.
- **Page detection requires contrast.** Works best when a light page rests on a dark background. Strong shadows, white-on-white surfaces, or patterned tables may fail detection; manual corner adjustment is provided for these cases.
- **PDF text layer alignment.** Unchanged and corrected words retain recognized bounding boxes. Words added during manual text review are positioned approximately next to neighbouring words.
- **Large inputs are limited** (50 MB, 40 megapixels). Supported formats are PNG and JPEG.
- Output location: `Captures/documents/<id>/` (original copy, processed image, `ocr.json`, `text.txt`, `manifest.json`, `searchable.pdf`).

## Privacy

Images and text stay on this computer. Outputs are written under `Captures/documents/`, which is git-ignored. The IPC
layer only accepts opaque session ids and file names from the captures folder; file locations are chosen by a native
dialog in the main process.

## Testing

`npm run test:document` runs the document tests. They cover image decoding and size guards, EXIF orientation, page
detection and perspective correction on generated photos, rotation and deskew, OCR result handling, cancellation,
timeouts and worker cleanup (with a scripted fake engine), PDF structure and text layer, and the non-destructive
workflow, edited-text alignment, and privacy/network boundaries. One smoke test drives the **real** tesseract.js engine on
a synthetic image; it is skipped, with a reason, if the engine or language data is missing. UI behavior is tested with a
mocked main process. See [testing.md](testing.md).
