# Real-Photograph OCR Validation Report (Phase 11.2)

**Generated:** 2026-10-17T22:24:10.784Z  
**Status:** **PENDING REAL-PHOTO DATASET COLLECTION**  
**Environment:** Node v20.20.1, win32 10.0.26200 (8 CPUs)  
**Cloud Privacy:** 0 external requests (Tesseract.js running 100% locally on-device)  

---

## 1. Executive Summary

As of Phase 11.2, **no real phone-photographed document samples have been supplied** in the local repository workspace (`tests/fixtures/ocr/real-photos/`). Per project rules:
> *"If no real photographs are available, build the validation harness and provide an explicit manual collection procedure. Mark real-photo validation as pending rather than inventing results."*

The reproducible validation harness is fully implemented in `tests/validation/real-photo-validation.ts` and wired to `npm run validate:ocr:real`. When real photo fixtures are placed in `tests/fixtures/ocr/real-photos/` alongside their ground truth `.txt` transcripts, the harness automatically executes CER/WER measurement, page edge detection scoring, and preprocessing comparison.

---

## 2. Documented Normalization Policy

To avoid distorting accuracy measurements:
- **Whitespace and line endings:** Consecutive whitespace characters (including newlines and tabs) are collapsed into a single space, and leading/trailing whitespace is trimmed.
- **Punctuation and casing:** **STRICTLY PRESERVED.** Punctuation marks (quotes, hyphens, periods, commas, brackets) and case distinctions (uppercase vs. lowercase) are **never stripped or folded**. Real-world OCR utility depends heavily on correct casing and punctuation (e.g. for code, serial numbers, legal text, financial amounts).

```ts
function normalizeOcrText(t: string): string {
  return t.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}
```

---

## 3. Real-Photograph Collection Procedure

To populate the benchmark dataset with authentic, non-sensitive samples, follow this 7-condition protocol:

### Target Document
- Use a single-page non-sensitive printed document (e.g., open-source software license, public domain text, or sample invoice generated from public templates).
- Never use personal identification documents, financial account statements, passwords, or confidential communications.

### Required Test Conditions (7 Categories)

| ID | Condition | Capture Setup | Ground Truth File |
|---|---|---|---|
| `01-clean-well-lit` | Clean, well-lit page | Phone held parallel directly above page; even ambient daylight; no harsh shadows. | `01-clean-well-lit.txt` |
| `02-shadows` | Uneven lighting / shadows | Desk lamp from side; phone or hand casting diagonal shadow across ~50% of the text. | `02-shadows.txt` |
| `03-perspective-mild` | Mild perspective | Phone tilted 15°–20° relative to page plane. | `03-perspective-mild.txt` |
| `04-perspective-strong`| Substantial perspective | Phone tilted 35°–45° creating noticeable trapezoidal keystoning. | `04-perspective-strong.txt` |
| `05-rotation-skew` | Slight rotation | Page rotated 5°–10° off-axis on dark tabletop. | `05-rotation-skew.txt` |
| `06-low-contrast` | Low contrast | Dim ambient lighting or printed on colored/gray background. | `06-low-contrast.txt` |
| `07-mild-blur` | Mild camera blur | Slight hand movement during capture or minor focal inaccuracy. | `07-mild-blur.txt` |
| `08-edge-text` | Text near margins | Header/footer text within 5–8 mm of physical paper boundary. | `08-edge-text.txt` |

### Directory Structure & File Naming
Place samples into `tests/fixtures/ocr/real-photos/`:
```text
tests/fixtures/ocr/real-photos/
├── manifest.json
├── 01-clean-well-lit.jpg
├── 01-clean-well-lit.txt
├── 02-shadows.jpg
├── 02-shadows.txt
├── ...
```

### Manifest Format (`manifest.json`)
```json
{
  "01-clean-well-lit": {
    "condition": "clean-well-lit",
    "device": "Pixel 7 / 12MP rear camera",
    "lighting": "5000K diffused LED",
    "description": "Standard flat printed A4 document"
  }
}
```

---

## 4. Benchmark Execution

Once photos are added, run:
```powershell
npm run validate:ocr:real
```

The runner will measure:
1. **Character Error Rate (CER):** Levenshtein distance / reference character length.
2. **Word Error Rate (WER):** Levenshtein word token distance / reference word count.
3. **Detection Accuracy:** Whether `detectDocumentCorners` successfully identified the page boundary.
4. **Preprocessing Impact:** Comparison of accuracy with and without perspective correction & contrast enhancement.
5. **Processing Time:** Execution latency for import, warp, and local OCR.
