# Real-Photograph OCR Dataset Directory

Place user-provided, non-sensitive printed page photographs in this directory to evaluate with `npm run validate:ocr:real`.

## Required Files per Sample

For each sample with identifier `<sample-id>` (e.g. `01-clean-well-lit`):
1. **Image:** `<sample-id>.jpg` or `<sample-id>.png` (photographed with a phone camera)
2. **Ground Truth Transcript:** `<sample-id>.txt` (exact text transcription, UTF-8 encoded)

## Supported Conditions
1. `clean-well-lit`: Clean, well-lit page under even diffused light
2. `shadows`: Uneven lighting with cast shadows
3. `perspective-mild`: 15°–20° tilt
4. `perspective-strong`: 35°–45° tilt
5. `rotation-skew`: 5°–10° off-axis rotation
6. `low-contrast`: Subdued contrast or colored paper
7. `mild-blur`: Minor camera shake / focal softness
8. `edge-text`: Text near paper borders

## Privacy Notice
Do not place sensitive, personal, financial, or confidential documents here.
All processing is local; images are never uploaded to any remote service.
