import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function getVersion(): string {
  try {
    // Check if we're running from a bundled environment
    const isBundled = fileURLToPath(import.meta.url).includes('bundle.cjs');
    
    let packageJsonPath: string;
    if (isBundled) {
      // In bundled environment (e.g., Docker container), package.json is in the app directory
      packageJsonPath = path.resolve(process.cwd(), 'package.json');
    } else {
      // In development/non-bundled environment, resolve relative to this module's location
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      packageJsonPath = path.resolve(__dirname, '../../package.json');
    }
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || '0.0.0';
  } catch (error) {
    console.error('Failed to read version from package.json:', error);
    return '0.0.0';
  }
}
