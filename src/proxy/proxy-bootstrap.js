/* eslint-disable no-console */
// This file runs in the proxy process before TypeScript types are available.
// console.error is used intentionally for debugging proxy startup.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bootstrapLogPrefix = `[Bootstrap ${new Date().toISOString()}]`;
let proofFilePath = ''; // Will be set after CWD change

// Function to attempt logging to a proof file, with console fallback
function logBootstrapActivity(message) {
  console.error(`${bootstrapLogPrefix} ${message}`); // Always log to stderr
  if (proofFilePath) {
    try {
      fs.appendFileSync(proofFilePath, `${bootstrapLogPrefix} ${message}\n`);
    } catch (e) {
      // Log failure to stderr if proof file write fails
      console.error(`${bootstrapLogPrefix} FAILED TO WRITE TO PROOF FILE (${proofFilePath}): ${e.message}.`);
    }
  }
}

logBootstrapActivity(`Bootstrap script initially started. Initial CWD: ${process.cwd()}`);

if (process.env.MCP_SERVER_CWD) {
  logBootstrapActivity(`MCP_SERVER_CWD is set to: ${process.env.MCP_SERVER_CWD}`);
  try {
    process.chdir(process.env.MCP_SERVER_CWD);
    logBootstrapActivity(`Successfully changed CWD to: ${process.cwd()}`);
    // Now that CWD is set, define the proofFilePath relative to the new CWD
    proofFilePath = path.join(process.cwd(), 'logs', 'proxy_bootstrap_proof.txt');
    // Ensure logs directory exists for the proof file
    try {
      fs.mkdirSync(path.dirname(proofFilePath), { recursive: true });
    } catch (mkdirErr) {
      logBootstrapActivity(`Could not create logs directory for proof file: ${mkdirErr.message}`);
      proofFilePath = ''; // Disable proof file logging if dir creation fails
    }
  } catch (err) {
    logBootstrapActivity(`Failed to change CWD to ${process.env.MCP_SERVER_CWD}: ${err.message}. Remaining in ${process.cwd()}`);
    // Define proofFilePath based on the CWD we ended up in, if possible
    proofFilePath = path.join(process.cwd(), 'logs', 'proxy_bootstrap_proof_fallback.txt');
     try {
      fs.mkdirSync(path.dirname(proofFilePath), { recursive: true });
    } catch (mkdirErr) {
      logBootstrapActivity(`Could not create logs directory for fallback proof file: ${mkdirErr.message}`);
      proofFilePath = ''; 
    }
  }
} else {
  logBootstrapActivity('MCP_SERVER_CWD environment variable not set. Remaining in initial CWD.');
  // Define proofFilePath based on the initial CWD
  proofFilePath = path.join(process.cwd(), 'logs', 'proxy_bootstrap_proof_no_mcp_cwd.txt');
   try {
      fs.mkdirSync(path.dirname(proofFilePath), { recursive: true });
    } catch (mkdirErr) {
      logBootstrapActivity(`Could not create logs directory for no_mcp_cwd proof file: ${mkdirErr.message}`);
      proofFilePath = '';
    }
}

(async () => {
  try {
    // Set environment variable to explicitly signal proxy mode
    process.env.DAP_PROXY_WORKER = 'true';
    logBootstrapActivity('Setting DAP_PROXY_WORKER environment variable to indicate proxy mode.');
    
    // Determine which proxy version to load
    const bundlePath = path.join(__dirname, 'proxy-bundle.cjs');
    const entryPath = path.join(__dirname, 'dap-proxy-entry.js');
    
    // Check if bundle exists and decide which version to use
    const useBundle = (
      process.env.NODE_ENV === 'production' || 
      process.env.MCP_CONTAINER === 'true' ||
      fs.existsSync(bundlePath)
    );
    
    const proxyPath = useBundle ? bundlePath : entryPath;
    logBootstrapActivity(`Using ${useBundle ? 'bundled' : 'unbundled'} proxy from: ${proxyPath}`);
    
    // Verify the chosen file exists
    if (!fs.existsSync(proxyPath)) {
      logBootstrapActivity(`ERROR: Proxy file not found at ${proxyPath}`);
      if (useBundle) {
        logBootstrapActivity('Bundle was expected but not found. Build may have failed.');
      }
      process.exit(1);
    }
    
    // Convert to file URL for ESM import
    // On Windows: file:///C:/path/to/file
    // On Unix: file:///path/to/file
    const normalizedPath = proxyPath.replace(/\\/g, '/');
    const proxyUrl = normalizedPath.startsWith('/') 
      ? `file://${normalizedPath}`  // Unix path already has leading slash
      : `file:///${normalizedPath}`; // Windows path needs three slashes
    logBootstrapActivity(`Importing proxy from URL: ${proxyUrl}`);
    
    try {
      await import(proxyUrl);
      logBootstrapActivity(`Dynamic import of ${useBundle ? 'bundled' : 'unbundled'} proxy succeeded.`);
    } catch (importError) {
      const errorMessage = importError instanceof Error ? `${importError.name}: ${importError.message}\n${importError.stack}` : String(importError);
      logBootstrapActivity(`ERROR during dynamic import of proxy: ${errorMessage}`);
      throw importError;
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
    logBootstrapActivity(`ERROR during proxy bootstrap: ${errorMessage}`);
    process.exit(1); 
  }
})();
