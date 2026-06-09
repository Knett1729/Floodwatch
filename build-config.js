const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const publicDir = path.join(projectRoot, 'public');
const backendUrl = process.env.API_BASE || 'http://localhost:5000';
const sourceFiles = [
  'index.html',
  'about.html',
  'alerts.html',
  'history.html',
  'map.html',
  'predict.html',
];
const sourceDirs = ['css', 'js'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyRecursive(srcDir, destDir) {
  ensureDir(destDir);
  for (const item of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else if (stat.isFile()) {
      copyFile(srcPath, destPath);
    }
  }
}

if (fs.existsSync(publicDir)) {
  fs.rmSync(publicDir, { recursive: true, force: true });
}
ensureDir(publicDir);

for (const file of sourceFiles) {
  copyFile(path.join(projectRoot, file), path.join(publicDir, file));
}

for (const dir of sourceDirs) {
  copyRecursive(path.join(projectRoot, dir), path.join(publicDir, dir));
}

const configPath = path.join(publicDir, 'js', 'config.js');
const content = `// config.js — project-wide runtime configuration\n` +
  `// This file is generated at build time when deploying to Vercel.\n` +
  `// Locally it defaults to localhost for development.\n` +
  `window.API_BASE = '${backendUrl}';\n`;

fs.writeFileSync(configPath, content, 'utf8');
console.log(`Generated ${configPath} with API_BASE=${backendUrl}`);
