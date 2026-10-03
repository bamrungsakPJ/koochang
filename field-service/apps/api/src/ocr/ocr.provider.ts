/** Nameplate reading. No OCR provider is chosen yet; production without one answers 503 to new
 * requests and the app continues with manual entry. Suggestions never overwrite equipment data. */
export interface OcrResult {
  fields: { brand?: string; model?: string; serial_number?: string };
  raw_text?: string;
  confidence?: number;
}

/** A temporary failure (timeout, provider 5xx): retried, never counted against the quota. */
export class TemporaryOcrError extends Error {}

export abstract class OcrProvider {
  abstract readonly name: string;
  abstract read(image: Buffer): Promise<OcrResult>;
}

/** Development only: reads nothing and returns empty suggestions, so the manual-entry path is
 * what gets exercised. Refuses to exist in production. */
export class DevelopmentOcrProvider extends OcrProvider {
  readonly name = 'development';
  constructor(production: boolean) { super(); if (production) throw new Error('DEVELOPMENT_OCR_IN_PRODUCTION'); }
  async read(image: Buffer): Promise<OcrResult> {
    if (!image.length) throw new TemporaryOcrError('EMPTY_IMAGE');
    return { fields: {}, raw_text: '', confidence: 0 };
  }
}

export function createOcrProvider(env: NodeJS.ProcessEnv = process.env): OcrProvider | null {
  const production = env.NODE_ENV === 'production';
  const provider = env.OCR_PROVIDER ?? (production ? undefined : 'development');
  return provider === 'development' && !production ? new DevelopmentOcrProvider(production) : null;
}

export const OCR_PROVIDER = Symbol('OCR_PROVIDER');
