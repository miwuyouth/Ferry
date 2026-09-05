'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (process.platform === 'darwin') {
  const plistPath = path.join(__dirname, '..', 'node_modules/electron/dist/Electron.app/Contents/Info.plist');
  if (fs.existsSync(plistPath)) {
    try {
      execSync(`plutil -replace CFBundleDisplayName -string "Ferry" "${plistPath}"`);
      execSync(`plutil -replace CFBundleName -string "Ferry" "${plistPath}"`);
    } catch {
      // Ignore if plutil fails
    }
  }
}
