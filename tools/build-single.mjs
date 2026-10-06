// Baut eine einzelne HTML-Datei, die per Doppelklick (file://) läuft: alle ES-Module werden zusammengefasst, CSS eingebettet.
// Aufruf: node tools/build-single.mjs  ->  dist/fahrrinne-frei.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mods = new Map(); // absoluter Pfad -> { id, code, deps }
const order = [];

function load(file) {
  if (mods.has(file)) return mods.get(file).id;
  const id = mods.size;
  const m = { id, code: '', deps: [] };
  mods.set(file, m);
  let src = readFileSync(file, 'utf8');
  const imports = [];
  src = src.replace(/^import\s+(?:\{([^}]*)\}|\*\s+as\s+(\w+))\s+from\s+'([^']+)';?[ \t]*$/gm, (_, names, ns, spec) => {
    const dep = load(resolve(dirname(file), spec));
    imports.push({ names, ns, dep });
    return '';
  });
  const exportsList = [];
  src = src.replace(/^export\s+(const|let|function|class)\s+(\w+)/gm, (_, kind, name) => { exportsList.push(name); return `${kind} ${name}`; });
  src = src.replace(/^export\s+\{([^}]*)\};?[ \t]*$/gm, (_, names) => { for (const n of names.split(',')) { const [a, b] = n.trim().split(/\s+as\s+/); if (a) exportsList.push(b ? `${b}: ${a}` : a); } return ''; });
  const pre = imports.map(({ names, ns, dep }) => ns ? `const ${ns} = __m(${dep});` : `const { ${names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ': ')).join(', ')} } = __m(${dep});`).join('\n');
  const ret = exportsList.map((e) => (e.includes(':') ? e : `${e}: ${e}`)).join(', ');
  m.code = `function(){\n${pre}\n${src}\nreturn { ${ret} };\n}`;
  order.push(id);
  return id;
}

const entry = load(resolve(root, 'src/main.js'));
const byId = [...mods.values()].sort((a, b) => a.id - b.id);
const bundle = `const __defs = [\n${byId.map((m) => m.code).join(',\n')}\n];\nconst __cache = [];\nfunction __m(i) { if (!__cache[i]) { __cache[i] = {}; __cache[i] = __defs[i](); } return __cache[i]; }\n__m(${entry});`;

let html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'style.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${bundle.replace(/<\/script>/g, '<\\/script>')}\n</script>`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/fahrrinne-frei.html'), html);
console.log('dist/fahrrinne-frei.html', Math.round(html.length / 1024), 'KB,', mods.size, 'Module');
