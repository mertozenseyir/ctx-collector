import fs from 'fs';
import path from 'path';

// import ... from '...' / import '...' ifadelerindeki modül yolunu yakalar
const IMPORT_RE = /(?:import\s+(?:[\s\S]*?)\s+from\s+|import\s+|export\s+(?:[\s\S]*?)\s+from\s+)['"]([^'"]+)['"]/g;

function isBareModule(spec, cfg) {
  if (spec.startsWith('.')) return false;
  // alias eşleşiyorsa bare değil
  for (const a of Object.keys(cfg.aliases)) {
    if (spec.startsWith(a)) return false;
  }
  // ignore prefix -> bare (atla)
  return true;
}

function resolveSpec(spec, fromFile, cfg) {
  let base;
  if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    // alias eşle
    let matched = null;
    for (const [a, target] of Object.entries(cfg.aliases)) {
      if (spec.startsWith(a)) {
        matched = path.join(cfg.frontendRoot, target, spec.slice(a.length));
        break;
      }
    }
    if (!matched) return null;
    base = matched;
  }
  return tryResolveFile(base, cfg);
}

function tryResolveFile(base, cfg) {
  // 1) doğrudan dosya
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  // 2) uzantı ekleyerek
  for (const ext of cfg.extensions) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  // 3) index dosyası (barrel)
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of cfg.extensions) {
      const idx = path.join(base, 'index' + ext);
      if (fs.existsSync(idx)) return idx;
    }
  }
  return null;
}

// Bir .ts component/service dosyasının yanındaki template/style dosyaları
function siblingTemplates(file, cfg) {
  if (!cfg.pullSiblingTemplates || !file.endsWith('.ts')) return [];
  const out = [];
  const stem = file.slice(0, -3); // .ts at
  for (const ext of ['.html', '.scss', '.css']) {
    if (fs.existsSync(stem + ext)) out.push(stem + ext);
  }
  // templateUrl / styleUrls içindeki yolları da yakala
  const src = fs.readFileSync(file, 'utf8');
  const urlRe = /(?:templateUrl|styleUrls?)\s*:\s*\[?\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = urlRe.exec(src))) {
    const resolved = path.resolve(path.dirname(file), m[1]);
    if (fs.existsSync(resolved)) out.push(resolved);
  }
  return out;
}

/**
 * entryFile'dan başlayıp import zincirini recursive takip eder.
 * Döner: { files: Set<string>, endpoints: [...], missing: [...] }
 */
export function scanFrontend(entryFile, cfg) {
  const visited = new Set();
  const collected = new Set();
  const missing = [];
  const maxDepth = (cfg.frontendDepth == null) ? 0 : cfg.frontendDepth; // 0 = sınırsız
  const queue = [{ file: path.resolve(entryFile), depth: 0 }];

  while (queue.length) {
    const { file, depth } = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!fs.existsSync(file)) { missing.push(file); continue; }
    collected.add(file);

    // sibling template/style
    for (const sib of siblingTemplates(file, cfg)) {
      collected.add(sib);
    }

    if (!/\.(ts)$/.test(file)) continue; // sadece ts içinden import takip et
    // derinlik sınırına ulaşıldıysa daha derine inme
    if (maxDepth > 0 && depth >= maxDepth) continue;

    const src = fs.readFileSync(file, 'utf8');
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[1];
      if (cfg.ignoreImportPrefixes.some(p => spec.startsWith(p))) continue;
      if (isBareModule(spec, cfg)) continue;
      const resolved = resolveSpec(spec, file, cfg);
      if (resolved) {
        if (!visited.has(resolved)) queue.push({ file: resolved, depth: depth + 1 });
      } else {
        missing.push(`${spec} (from ${path.basename(file)})`);
      }
    }
  }

  return { files: collected, missing };
}

// ---------------------------------------------------------------------------
// TERS ARAMA (backend-only mod için)
// Verilen endpoint'lere (controller/action) giden frontend servislerini bulur,
// o servisleri kullanan component'leri bulur ve hepsinin zincirini toplar.
// ---------------------------------------------------------------------------
import fg from 'fast-glob';

export async function findFrontendUsers(endpoints, cfg) {
  const collected = new Set();
  const missing = [];
  if (!cfg.frontendRoot || !endpoints.length) return { files: collected, missing };

  const allTs = await fg('src/**/*.ts', {
    cwd: cfg.frontendRoot, absolute: true,
    ignore: ['**/*.spec.ts', '**/node_modules/**']
  });

  // 1) endpoint URL'lerine giden servis dosyalarını bul
  //    (controller/action ikilisini içeren http çağrısı)
  const serviceFiles = new Set();
  const wanted = endpoints.map(e => ({
    ctrl: e.controller.toLowerCase(),
    action: (e.action || '').toLowerCase()
  }));
  for (const f of allTs) {
    const src = fs.readFileSync(f, 'utf8').toLowerCase();
    for (const w of wanted) {
      // `/controller/action` şeklinde geçiyor mu
      if (w.action && src.includes(`/${w.ctrl}/${w.action}`)) { serviceFiles.add(f); break; }
      if (!w.action && src.includes(`/${w.ctrl}/`)) { serviceFiles.add(f); break; }
    }
  }

  // 2) bu servis SINIFLARININ adını çıkar (export class XService)
  const serviceClassNames = new Set();
  for (const sf of serviceFiles) {
    const src = fs.readFileSync(sf, 'utf8');
    const re = /export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let m; while ((m = re.exec(src))) serviceClassNames.add(m[1]);
  }

  // 3) bu servisleri DI ile kullanan component'leri bul
  const componentFiles = new Set();
  if (serviceClassNames.size) {
    for (const f of allTs) {
      if (!/\.component\.ts$/.test(f)) continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const cn of serviceClassNames) {
        const re = new RegExp(`\\b${cn}\\b`);
        if (re.test(src)) { componentFiles.add(f); break; }
      }
    }
  }

  // 4) servis + component'lerin tam import zincirini topla
  const seeds = new Set([...serviceFiles, ...componentFiles]);
  for (const seed of seeds) {
    const r = scanFrontend(seed, cfg);
    r.files.forEach(x => collected.add(x));
    missing.push(...r.missing);
  }

  return { files: collected, missing, serviceFiles: [...serviceFiles], componentFiles: [...componentFiles] };
}
