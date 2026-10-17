import { OcrWord } from './ocr';
import { DocumentError } from './image';

/**
 * Aligns user-edited text with the original OCR words so a searchable PDF can carry the *reviewed* text.
 *
 * Words are compared as whitespace-separated tokens with a word-level edit-distance alignment:
 *  - unchanged and replaced words keep the original word's bounding box (exact position),
 *  - deleted words are dropped,
 *  - inserted words are placed immediately after the previous kept word (or before the first word), using that
 *    neighbour's height - their position is therefore approximate.
 */

export interface AlignmentResult {
  words: OcrWord[];
  unchanged: number;
  replaced: number;
  inserted: number;
  removed: number;
}

export const MAX_ALIGNMENT_CELLS = 16_000_000;

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(t => t.length > 0);
}

export function alignEditedText(ocrWords: OcrWord[], editedText: string): AlignmentResult {
  const edited = tokenize(editedText);
  const source = ocrWords.filter(w => w.text.trim().length > 0);
  if (edited.length === 0) {
    throw new DocumentError('INVALID_ARGUMENT', 'The text is empty, so there is nothing to embed in the PDF.');
  }
  if (source.length === 0) {
    throw new DocumentError('INVALID_ARGUMENT', 'There are no recognized words to position the text on the page.');
  }
  const n = source.length;
  const m = edited.length;
  if ((n + 1) * (m + 1) > MAX_ALIGNMENT_CELLS) {
    throw new DocumentError('INVALID_ARGUMENT', 'The edited text is too long to align with the page. Export the unedited text or shorten the edits.');
  }

  // dp[i][j] = edit distance between source[0..i) and edited[0..j)
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = 0; i <= n; i++) dp[i * w] = Math.min(65535, i);
  for (let j = 0; j <= m; j++) dp[j] = Math.min(65535, j);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = source[i - 1].text === edited[j - 1] ? 0 : 1;
      dp[i * w + j] = Math.min(dp[(i - 1) * w + j] + 1, dp[i * w + j - 1] + 1, dp[(i - 1) * w + j - 1] + cost);
    }
  }

  // Trace back
  type Op = { kind: 'keep' | 'replace' | 'delete' | 'insert'; src?: number; dst?: number };
  const ops: Op[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i * w + j] === dp[(i - 1) * w + j - 1] + (source[i - 1].text === edited[j - 1] ? 0 : 1)) {
      ops.push({ kind: source[i - 1].text === edited[j - 1] ? 'keep' : 'replace', src: i - 1, dst: j - 1 });
      i--; j--;
    } else if (i > 0 && dp[i * w + j] === dp[(i - 1) * w + j] + 1) {
      ops.push({ kind: 'delete', src: i - 1 });
      i--;
    } else {
      ops.push({ kind: 'insert', dst: j - 1 });
      j--;
    }
  }
  ops.reverse();

  const words: OcrWord[] = [];
  let unchanged = 0, replaced = 0, inserted = 0, removed = 0;
  let last: OcrWord | null = null;
  const pendingInserts: string[] = [];
  const place = (text: string, anchor: OcrWord, after: boolean) => {
    const width = Math.max(1, anchor.bbox.x1 - anchor.bbox.x0);
    const height = anchor.bbox.y1 - anchor.bbox.y0;
    const perChar = width / Math.max(1, anchor.text.length);
    const newWidth = Math.max(4, perChar * text.length);
    const x0 = after ? anchor.bbox.x1 + perChar * 0.4 : Math.max(0, anchor.bbox.x0 - newWidth - perChar * 0.4);
    return { text, confidence: 0, bbox: { x0, y0: anchor.bbox.y0, x1: x0 + newWidth, y1: anchor.bbox.y0 + height } } as OcrWord;
  };

  for (const op of ops) {
    if (op.kind === 'delete') { removed++; continue; }
    if (op.kind === 'insert') {
      const text = edited[op.dst as number];
      if (last) {
        const w2 = place(text, last, true);
        words.push(w2);
        last = w2;
      } else {
        pendingInserts.push(text);
      }
      inserted++;
      continue;
    }
    const src = source[op.src as number];
    const text = edited[op.dst as number];
    if (op.kind === 'keep') unchanged++; else replaced++;
    // Flush inserts that came before the first kept/replaced word, placed to its left.
    if (pendingInserts.length) {
      let anchor: OcrWord = src;
      for (const t of pendingInserts.splice(0).reverse()) {
        const w2 = place(t, anchor, false);
        words.unshift(w2);
        anchor = w2;
      }
    }
    const placed: OcrWord = { text, confidence: src.confidence, bbox: { ...src.bbox } };
    words.push(placed);
    last = placed;
  }
  if (pendingInserts.length && words.length === 0) {
    // Everything was deleted and only insertions remain: anchor them to the first original word.
    let anchor = source[0];
    for (const t of pendingInserts) {
      const w2 = place(t, anchor, true);
      words.push(w2);
      anchor = w2;
    }
  }
  return { words, unchanged, replaced, inserted, removed };
}
