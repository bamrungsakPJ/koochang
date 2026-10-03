import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Private object storage. Keys are internal; files are only reachable through signed API URLs. */
export abstract class ObjectStorage {
  abstract readonly kind: string;
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

const keyPattern = /^[a-z0-9][a-z0-9/_-]*\.(jpg|jpeg|png|webp)$/;

/** Files on the server's own disk (on-premise). The directory must not be served publicly and
 * belongs in the backup plan. A cloud/S3 adapter can replace it behind the same interface. */
export class LocalDiskStorage extends ObjectStorage {
  readonly kind = 'local_disk';
  private readonly root: string;
  constructor(directory: string) { super(); this.root = resolve(directory); }

  private path(key: string): string {
    if (!keyPattern.test(key) || key.includes('..')) throw new Error('INVALID_STORAGE_KEY');
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('INVALID_STORAGE_KEY');
    return full;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, target);
  }
  get(key: string): Promise<Buffer> { return readFile(this.path(key)); }
  async delete(key: string): Promise<void> { await rm(this.path(key), { force: true }); }
}

export function createStorage(mediaDir: string | undefined): ObjectStorage | null {
  return mediaDir ? new LocalDiskStorage(mediaDir) : null;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
