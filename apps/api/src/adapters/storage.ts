import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/**
 * Object storage abstraction (req §38). Keys are generated server-side only
 * ("<tenant>/<yyyy>/<mm>/<media>.<ext>"), never taken from user input.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; size: number } | null>;
}

/** Dev / single-server storage on local disk. Swap for an S3-compatible (MinIO) adapter later. */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string) {
    const file = this.resolve(key);
    try {
      const s = await stat(file);
      return { stream: createReadStream(file), size: s.size };
    } catch {
      return null;
    }
  }

  private resolve(key: string): string {
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return file;
  }
}
