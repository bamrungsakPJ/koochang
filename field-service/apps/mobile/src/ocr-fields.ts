export const ocrFields = ['brand', 'model', 'serial_number'] as const;
export type OcrField = typeof ocrFields[number];

/** A manual edit (including clearing a field) wins over this and later OCR attempts. */
export function applyOcrFields<T extends Record<OcrField, string>>(
  current: T, suggestions: Record<string, unknown>, manual: Partial<Record<OcrField, boolean>>,
): T {
  const next = { ...current };
  for (const field of ocrFields) {
    const value = suggestions[field];
    if (!manual[field] && typeof value === 'string' && value.trim()) next[field] = value.trim().slice(0, 80);
  }
  return next;
}
