#!/usr/bin/env node
/**
 * Bundle the MCP debugger server into a single file using esbuild
 */

import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

async function bundle() {
  console.log('Bundling MCP debugger server...');
  
  try {
    // Bundle the main application
    const result = await esbuild.build({
      entryPoints: ['dist/index.js'],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: 'dist/bundle.cjs',
      define: {
        'import.meta.url': JSON.stringify('file:///app/dist/bundle.cjs'),
        '__dirname': JSON.stringify('/app/dist')
      },
      external: [
        // Keep native modules external
        'fsevents'
      ],
      minify: true,
      sourcemap: false,
      metafile: true,
      logLevel: 'info'
    });

    // Write metafile for analysis
    fs.writeFileSync('dist/bundle-meta.json', JSON.stringify(result.metafile));
    
    // Copy proxy-bootstrap.js to dist if it exists
    const proxyBootstrapSrc = path.join('src', 'proxy', 'proxy-bootstrap.js');
    const proxyBootstrapDest = path.join('dist', 'proxy', 'proxy-bootstrap.js');
    
    if (fs.existsSync(proxyBootstrapSrc)) {
      const proxyDir = path.dirname(proxyBootstrapDest);
      if (!fs.existsSync(proxyDir)) {
        fs.mkdirSync(proxyDir, { recursive: true });
      }
      fs.copyFileSync(proxyBootstrapSrc, proxyBootstrapDest);
      console.log('Copied proxy-bootstrap.js');
    }

    // Calculate bundle size
    const stats = fs.statSync('dist/bundle.cjs');
    const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`Bundle created successfully: ${sizeInMB} MB`);
    
    // Show what's included
    const text = await esbuild.analyzeMetafile(result.metafile, {
      verbose: false
    });
    console.log('\nBundle analysis:');
    console.log(text);
    
    // Create proxy bundle
    console.log('\nCreating proxy bundle...');
    const proxyResult = await esbuild.build({
      entryPoints: ['dist/proxy/dap-proxy-entry.js'],
      bundle: true,
      platform: 'node',
      outfile: 'dist/proxy/proxy-bundle.cjs',
      format: 'cjs',
      target: 'node20',
      define: {
        'import.meta.url': JSON.stringify('file:///app/dist/proxy/proxy-bundle.cjs'),
        '__dirname': JSON.stringify('/app/dist/proxy')
      },
      external: [], // Bundle ALL dependencies - don't exclude anything
      minify: false, // Keep readable for debugging
      sourcemap: 'inline',
      metafile: true,
      logLevel: 'info'
    });

    // Analyze proxy bundle
    if (proxyResult.metafile) {
      const proxyText = await esbuild.analyzeMetafile(proxyResult.metafile);
      console.log('\nProxy bundle analysis:');
      console.log(proxyText);
    }
    
    // Verify proxy bundle was created and check size
    if (fs.existsSync('dist/proxy/proxy-bundle.cjs')) {
      const proxyStats = fs.statSync('dist/proxy/proxy-bundle.cjs');
      const proxySizeKB = (proxyStats.size / 1024).toFixed(2);
      console.log(`\nProxy bundle created successfully: ${proxySizeKB} KB`);
    } else {
      console.error('Proxy bundle was not created!');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Bundle failed:', error);
    process.exit(1);
  }
}

bundle();
