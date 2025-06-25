const fs = require('fs-extra');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'proxy');
const distDir = path.join(__dirname, '..', 'dist', 'proxy');

async function copyProxyFiles() {
  try {
    console.log('[Build] Copying proxy JavaScript files...');
    
    // Ensure dist/proxy directory exists
    await fs.ensureDir(distDir);
    
    // Get all .js files from src/proxy
    const files = await fs.readdir(srcDir);
    const jsFiles = files.filter(file => file.endsWith('.js'));
    
    let copiedCount = 0;
    for (const file of jsFiles) {
      const srcPath = path.join(srcDir, file);
      const distPath = path.join(distDir, file);
      
      // Copy file and preserve timestamps
      await fs.copy(srcPath, distPath, { 
        overwrite: true,
        preserveTimestamps: true 
      });
      
      console.log(`  ✓ Copied ${file}`);
      copiedCount++;
    }
    
    console.log(`[Build] Successfully copied ${copiedCount} proxy files to dist/proxy`);
  } catch (error) {
    console.error('[Build] Error copying proxy files:', error);
    process.exit(1);
  }
}

copyProxyFiles();
