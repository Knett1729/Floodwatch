const fs = require('fs');
const path = require('path');

const backendUrl = process.env.API_BASE || 'http://localhost:5000';
const configPath = path.join(__dirname, 'js', 'config.js');

const content = `// config.js — project-wide runtime configuration
// This file is generated at build time when deploying to Vercel.
// Locally it defaults to localhost for development.
window.API_BASE = '${backendUrl}';
`;

fs.writeFileSync(configPath, content, 'utf8');
console.log(`Generated ${configPath} with API_BASE=${backendUrl}`);
