# Document Intelligence (Local OCR)

The **Documents & OCR** tab turns a photo or screenshot of a document into straightened, editable, searchable text
without sending anything off the computer.

## Workflow

1. **Import** an image: choose a PNG/JPEG file, capture the connected phone's screen, or pick a saved capture.
2. **Review the page outline.** AndroScrn tries to find the edges of a sheet of paper and draws them over the preview.
3. **Adjust** (optional): crop and perspective-correct to the detected page, rotate in 90 degree steps, fine-rotate
   (the suggested straighten angle is offered when the text is skewed) and enhance contrast. Adjustments create a
   *processed copy*.
4. **Run OCR.** A progress bar shows the stage; **Cancel** stops it.
5. **Review and edit** the recognized text. The mean confidence, the number of low-confidence words and a list of the
   least certain words are shown so you know what to double-check.
6. **Save or export.** *Save to Captures/documents* writes a folder containing an untouched copy of the original, the
   processed image, the raw OCR result, your (possibly edited) text and a manifest with SHA-256 hashes.
   *Export searchable PDF* writes `searchable.pdf` into the same folder.

The original image is never modified: it is read once, held in memory, and only ever copied. The manifest records its
hash so you can verify that.

## How it works

| Step | Implementation (`modules/document_intelligence/`) |
| :--- | :--- |
| Decode / encode | `pngjs` and `jpeg-js` (pure JavaScript). JPEG EXIF orientation is applied. Files over 50 MB or 40 megapixels are rejected before decoding. |
| Page detection | Otsu threshold -> largest bright region -> convex hull -> four extreme points. Reports a rectangularity confidence. |
| Perspective correction | Homography solved from the four corners, bilinear sampling. |
| Rotation / deskew | 90 degree turns, arbitrary angles, projection-profile skew estimate (-15..+15 degrees). |
| OCR | [tesseract.js](https://github.com/naptha/tesseract.js) 7 (WebAssembly) in a worker thread, so recognition never blocks the app window. |
| Searchable PDF | A small built-in writer: the processed image as a JPEG page plus an invisible text layer (render mode 3) with one entry per recognized word at its bounding box. |

All OCR files are loaded from disk. The engine is configured with a local `langPath`, no cache files are written, and no
network request is made. Cancellation terminates the worker; a timeout (3 minutes) also terminates it.

## Requirements and distribution size

- **No cloud service, account or API key.** Everything runs locally on Windows 10/11 x64 (the platform AndroScrn
  supports).
- **Language:** English (`eng`) only. Other languages are not bundled and are not offered.
- **Size:** the portable build grew from about 127 MB to about 148 MB zipped (about 52 MB unpacked) because it now
  carries `tesseract.js`, its WebAssembly core and the English language data (about 3 MB). `npm install` adds the same
  packages for source builds.
- **Licenses:** tesseract.js and tesseract.js-core are Apache-2.0; the English data comes from the Tesseract
  `tessdata_best` set (Apache-2.0); pngjs is MIT; jpeg-js is BSD-3-Clause. See
  [dependencies-and-licenses.md](dependencies-and-licenses.md).
- If the OCR library or language data is missing, the panel shows why and still lets you crop and straighten images.

## Limitations (read before relying on it)

- **Accuracy is not established.** The automated tests use synthetic block-letter images, not real documents. No claim
  is made about accuracy on real photographs, handwriting, tables, small print or any language other than English.
  Check the confidence figures and read the output.
- **Page detection is a simple heuristic.** It needs a lighter page on a darker surface. White-on-white scans, strong
  shadows, curled pages and cluttered backgrounds can fail; the app then uses the full image. There is no manual
  corner dragging yet.
- **The PDF text layer is the OCR output.** Edits made in the text box are saved to `text.txt` but are not re-embedded.
  Only Latin-1 characters are representable in the invisible layer; others become `?`. Word widths are approximated, so
  selection highlights can be slightly off. Searchability was verified structurally (the text appears in the PDF
  content stream); it has not been checked in every PDF viewer.
- **Large inputs are limited** (50 MB, 40 megapixels). Very large images are slower to process.
- Only PNG and JPEG are supported (no HEIC, TIFF, PDF input).

## Privacy

Images and text stay on this computer. Outputs are written under `Captures/documents/`, which is git-ignored. The IPC
layer only accepts opaque session ids and file names from the captures folder; file locations are chosen by a native
dialog in the main process.

## Testing

`npm run test:document` runs the document tests. They cover image decoding and size guards, EXIF orientation, page
detection and perspective correction on generated photos, rotation and deskew, OCR result handling, cancellation,
timeouts and worker cleanup (with a scripted fake engine), PDF structure and text layer, and the non-destructive
workflow. One smoke test drives the **real** tesseract.js engine on a synthetic image; it is skipped, with a reason, if
the engine or language data is missing. UI behavior is tested with a mocked main process. See [testing.md](testing.md).
