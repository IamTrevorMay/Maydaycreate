// Concatenate ExtendScript files into a single dist file
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, '..', '..', 'dist', 'cep', 'host');

const files = ['json2.jsx', 'utils.jsx', 'project.jsx', 'timeline.jsx', 'markers.jsx', 'effects.jsx', 'bridge.jsx', 'index.jsx'];

let output = '// Mayday Create - ExtendScript Bundle\n// Auto-generated - do not edit\n\n';

for (const file of files) {
  const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
  output += '// === ' + file + ' ===\n' + content + '\n\n';
}

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, 'index.jsx'), output);
console.log('ExtendScript bundle written to dist/cep/host/index.jsx');
