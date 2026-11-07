const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'chrome-extension');
fs.mkdirSync(output, { recursive: true });
for (const name of ['background.js', 'content.js', 'popup.html', 'popup.css', 'popup.js']) {
  fs.copyFileSync(path.join(root, 'extension', name), path.join(output, name));
}
fs.copyFileSync(path.join(__dirname, 'manifest.json'), path.join(output, 'manifest.json'));
console.log(`Chrome extension built at ${output}`);
