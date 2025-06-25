/**
 * Concrete implementation of IFileSystem using fs-extra
 */
import fs from 'fs-extra';
import { Stats } from 'fs';
import { IFileSystem } from '../interfaces/external-dependencies.js';

export class FileSystemImpl implements IFileSystem {
  // Basic fs operations
  async readFile(path: string, encoding?: BufferEncoding): Promise<string> {
    return fs.readFile(path, encoding || 'utf-8');
  }

  async writeFile(path: string, data: string | Buffer): Promise<void> {
    return fs.writeFile(path, data);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(path, options);
  }

  async readdir(path: string): Promise<string[]> {
    return fs.readdir(path);
  }

  async stat(path: string): Promise<Stats> {
    return fs.stat(path);
  }

  async unlink(path: string): Promise<void> {
    return fs.unlink(path);
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      return fs.remove(path);
    }
    return fs.rmdir(path);
  }

  // fs-extra methods
  async ensureDir(path: string): Promise<void> {
    return fs.ensureDir(path);
  }

  ensureDirSync(path: string): void {
    return fs.ensureDirSync(path);
  }

  async pathExists(path: string): Promise<boolean> {
    return fs.pathExists(path);
  }

  existsSync(path: string): boolean {
    return fs.existsSync(path);
  }

  async remove(path: string): Promise<void> {
    return fs.remove(path);
  }

  async copy(src: string, dest: string): Promise<void> {
    return fs.copy(src, dest);
  }

  async outputFile(file: string, data: string | Buffer): Promise<void> {
    return fs.outputFile(file, data);
  }
}
