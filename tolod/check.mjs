// ============================================================
// Qube – kiadás előtti ellenőrzés
// A GitHub minden feltöltés után lefuttatja. Ha hibát talál, a kiadás
// leáll, és élesben a régi, működő verzió marad.
// Helyben is futtatható:  node tools/check.mjs
// ============================================================
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (file, msg) => errors.push(`✗ ${file}: ${msg}`);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const rel = (abs) => relative(ROOT, abs).split('\\').join('/');

const jsFiles = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);
const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith('.html'));

// ---------- 1) Szintaxis ----------
const tmp = mkdtempSync(join(tmpdir(), 'qube-'));
const syntax = (file, asModule) => {
    const target = join(tmp, file.replace(/[\\/]/g, '_') + (asModule ? '.mjs' : '.cjs'));
    writeFileSync(target, read(file));
    const r = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
    if (r.status !== 0) fail(file, `szintaktikai hiba\n    ${(r.stderr || '').split('\n').filter(Boolean).slice(0, 4).join('\n    ')}`);
};
jsFiles.forEach((f) => syntax(f, true));
syntax('sw.js', false);

// ---------- 2) Ugyanaz a tartalom két különböző fájlban (elrontott feltöltés) ----------
const seen = new Map();
for (const f of [...jsFiles, 'sw.js', ...htmlFiles, 'style.css']) {
    const body = read(f).trim();
    if (seen.has(body)) fail(f, `a tartalma megegyezik ezzel: ${seen.get(body)} – valószínűleg rossz fájl lett feltöltve`);
    else seen.set(body, f);
}

// ---------- 3) Importok ↔ exportok ----------
const names = (list, pickAlias) => list.split(',').map((x) => x.trim()).filter(Boolean)
    .map((x) => { const [a, b] = x.split(/\s+as\s+/); return (pickAlias && b ? b : a).trim(); });

const exportsOf = new Map();
const getExports = (file) => {
    if (exportsOf.has(file)) return exportsOf.get(file);
    const src = read(file);
    const out = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) names(m[1], true).forEach((n) => out.add(n));
    exportsOf.set(file, out);
    return out;
};

for (const f of jsFiles) {
    const src = read(f);
    const imports = [
        ...[...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => [m[1], m[2]]),
        ...[...src.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => [m[1].replace(/:\s*\w+/g, ''), m[2]])
    ];
    for (const m of src.matchAll(/import\s*['"](\.{1,2}\/[^'"]+)['"]/g)) imports.push(['', m[1]]);

    for (const [list, spec] of imports) {
        const target = rel(resolve(join(ROOT, dirname(f)), spec));
        if (!existsSync(join(ROOT, target))) { fail(f, `hiányzó fájlt importál: ${spec}`); continue; }
        const ex = getExports(target);
        for (const n of names(list, false)) {
            if (!ex.has(n)) fail(f, `"${n}" nincs exportálva ebben: ${target}`);
        }
    }
}

// ---------- 4) HTML hivatkozások ----------
for (const h of htmlFiles) {
    const src = read(h);
    for (const m of src.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"#?]+)"/g)) {
        const url = m[1];
        if (/^(https?:)?\/\//.test(url)) continue;
        if (!existsSync(join(ROOT, url))) fail(h, `hiányzó fájlra hivatkozik: ${url}`);
    }
}

// ---------- 5) Service Worker fájllista ----------
const sw = read('sw.js');
const shell = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!shell) fail('sw.js', 'nem található az APP_SHELL lista');
else {
    const listed = [...shell[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
    listed.forEach((p) => { if (!existsSync(join(ROOT, p))) fail('sw.js', `az APP_SHELL-ben szereplő fájl hiányzik: ${p}`); });
    [...jsFiles, ...htmlFiles.filter((h) => h !== 'reset.html')].forEach((p) => {
        if (!listed.includes(p)) fail('sw.js', `${p} nincs felvéve az APP_SHELL listába (offline nem lesz elérhető)`);
    });
}
if (!/^const VERSION = '[^']+';$/m.test(sw)) fail('sw.js', 'nem található a "const VERSION = \'...\';" sor');

// ---------- 6) Firebase kapcsolat ----------
const fc = existsSync(join(ROOT, 'js/firebase-config.js')) ? read('js/firebase-config.js') : '';
if (!/export const FIREBASE_CONFIG\s*=/.test(fc)) fail('js/firebase-config.js', 'nincs benne FIREBASE_CONFIG');
else if (/IDE_JON|PROJEKT-ID/.test(fc)) fail('js/firebase-config.js', 'még a minta adatok vannak benne – írd be a Firebase projekt adatait');
if (!/build:\s*'dev'/.test(read('js/config.js'))) fail('js/config.js', "nem található a build: 'dev' sor (a kiadás ide írja a verziót)");

// ---------- Eredmény ----------
if (errors.length) {
    console.error(`\nA kiadás LEÁLLT – ${errors.length} hiba. Élesben a korábbi verzió marad.\n`);
    console.error(errors.join('\n'));
    console.error('');
    process.exit(1);
}
console.log(`✓ Minden rendben (${jsFiles.length} JS modul, ${htmlFiles.length} HTML oldal).`);
