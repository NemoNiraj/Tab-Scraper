const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(process.cwd(), 'popup.js'), 'utf8');
try {
  new Function(src);
  console.log('NODE_PARSE_OK');
} catch (e) {
  console.error('NODE_PARSE_ERROR:\n', e.stack || e.toString());
  process.exit(2);
}
