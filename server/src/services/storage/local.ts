import { writeFile, unlink, stat, mkdir, copyFile } from 'fs/promises';
import path from 'path';
import type { StorageProvider } from './index.js';
import { config } from '../../config/index.js';

export class LocalStorageProvider implements StorageProvider {
  private audioDir: string;

  constructor() {
    // Derive the audio directory from the central config so that the storage
    // provider always writes to the same location the spawn service resolves
    // paths from (config.storage.audioDir, which honours the AUDIO_DIR env var).
    this.audioDir = config.storage.audioDir;
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filepath = path.join(this.audioDir, key);
    await mkdir(path.dirname(filepath), { recursive: true });
    await writeFile(filepath, data);
    return key;
  }

  async getUrl(key: string, _expiresIn?: number): Promise<string> {
    const cleanKey = key.startsWith('/audio/') ? key.slice('/audio/'.length) : key;
    return `/audio/${cleanKey.replace(/^\/+/, '')}`;
  }

  getPublicUrl(key: string): string {
    const cleanKey = key.startsWith('/audio/') ? key.slice('/audio/'.length) : key;
    return `/audio/${cleanKey.replace(/^\/+/, '')}`;
  }

  async delete(key: string): Promise<void> {
    const filepath = path.join(this.audioDir, key);
    try {
      await unlink(filepath);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const filepath = path.join(this.audioDir, key);
    try {
      await stat(filepath);
      return true;
    } catch {
      return false;
    }
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    const sourcePath = path.join(this.audioDir, sourceKey);
    const destPath = path.join(this.audioDir, destKey);
    await mkdir(path.dirname(destPath), { recursive: true });
    await copyFile(sourcePath, destPath);
  }
}
