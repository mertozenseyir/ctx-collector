#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { loadConfig } from './config.js';
import { scanFrontend, findFrontendUsers } from './frontend.js';
import { extractEndpoints } from './endpoints.js';
import { indexBackend, scanBackend, scanBackendFromServices } from './backend.js';
import { copyFiles } from './copy.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      // aynı bayrak birden çok kez -> dizi
      if (args[key] !== undefined) {
        args[key] = [].concat(args[key], val);
      } else args[key] = val;
    } else args._.push(a);
  }
  return args;
}

function toArr(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function resolveEntry(e, root) {
  if (path.isAbsolute(e)) return e;
  const asCwd = path.resolve(process.cwd(), e);
  if (fs.existsSync(asCwd)) return asCwd;
  if (root) {
    const asRoot = path.resolve(root, e);
    if (fs.existsSync(asRoot)) return asRoot;
  }
  return asCwd;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const cfg = loadConfig({
    ...(args.frontendRoot ? { frontendRoot: path.resolve(args.frontendRoot) } : {}),
    ...(args.backendRoot ? { backendRoot: path.resolve(args.backendRoot) } : {}),
    ...(args.output ? { output: args.output } : {}),
    ...(args.frontendDepth !== undefined ? { frontendDepth: parseInt(args.frontendDepth, 10) } : {}),
    ...(args.ignore ? { backendIgnore: toArr(args.ignore) } : {})
  });

  // UI ters arama bayrakları
  if (args['with-ui']) cfg.backendOnlyIncludeUi = true;
  if (args['no-ui']) cfg.backendOnlyIncludeUi = false;

  // --- MOD SEÇİMİ ---
  // backend-only: --backend-entry ile ya da config.backendEntries doluysa (ve normal entry yoksa)
  const cliBackendEntries = toArr(args['backend-entry']);
  const cfgBackendEntries = toArr(cfg.backendEntries);
  const frontendEntries = args._.length ? args._ : toArr(cfg.entries);

  const backendOnly = (cliBackendEntries.length || cfgBackendEntries.length) && !args._.length;
  const backendEntries = cliBackendEntries.length ? cliBackendEntries : cfgBackendEntries;

  if (args.help || (!frontendEntries.length && !backendEntries.length)) {
    console.log(`
ctx-collect — Angular component + API bağımlılık toplayıcı

Normal mod (frontend'den başla):
  ctx-collect <component.ts> [...]        veya config.entries
Backend-only mod (service'ten başla):
  ctx-collect --backend-entry <Service.cs> [--with-ui | --no-ui]
                                          veya config.backendEntries

Seçenekler:
  --frontendRoot <yol> / --backendRoot <yol> / --output <yol>
  --frontendDepth <n>   Frontend import zinciri derinliği (0=sınırsız)
  --ignore <proje>      Backend'de yok sayılacak proje/yol (çok kez verilebilir)
  --with-ui / --no-ui   Backend-only modda UI component'lerini de bul / bulma
  --no-backend          Normal modda backend'i atla
  --verbose
`);
    process.exit(frontendEntries.length || backendEntries.length ? 0 : 1);
  }

  // frontendRoot tahmini
  if (!cfg.frontendRoot && frontendEntries.length) {
    const abs = path.resolve(frontendEntries[0]);
    const srcIdx = abs.indexOf(`${path.sep}src${path.sep}`);
    cfg.frontendRoot = srcIdx >= 0 ? abs.slice(0, srcIdx) : path.dirname(abs);
  }

  const allFrontend = new Set();
  const allBackend = new Set();
  const allMissing = [];
  let endpoints = [];

  if (backendOnly) {
    // ================= BACKEND-ONLY MOD =================
    console.log(`\n[1/3] Backend indeksleniyor: ${cfg.backendRoot}`);
    const index = await indexBackend(cfg.backendRoot, cfg);
    console.log(`      ${index.files.length} .cs dosyası indekslendi.${cfg.backendIgnore.length ? ' (ignore: ' + cfg.backendIgnore.join(', ') + ')' : ''}`);

    const resolved = backendEntries.map(e => resolveEntry(e, cfg.backendRoot));
    console.log(`[2/3] Service zinciri toplanıyor: ${resolved.length} giriş`);
    const be = scanBackendFromServices(resolved, index, cfg);
    be.files.forEach(f => allBackend.add(f));
    endpoints = be.endpoints;
    console.log(`      ${allBackend.size} backend dosyası, ${be.controllers.length} controller, ${endpoints.length} endpoint.`);

    if (cfg.backendOnlyIncludeUi && cfg.frontendRoot) {
      console.log(`[3/3] UI ters araması (endpoint'leri kullanan component'ler)...`);
      const ui = await findFrontendUsers(endpoints, cfg);
      ui.files.forEach(f => allFrontend.add(f));
      allMissing.push(...ui.missing);
      console.log(`      ${ui.serviceFiles ? ui.serviceFiles.length : 0} servis, ${ui.componentFiles ? ui.componentFiles.length : 0} component, toplam ${allFrontend.size} frontend dosyası.`);
    } else {
      console.log(`[3/3] UI ters araması atlandı.`);
    }

  } else {
    // ================= NORMAL MOD =================
    const resolved = frontendEntries.map(e => resolveEntry(e, cfg.frontendRoot));
    console.log(`\n[1/4] Frontend taranıyor: ${resolved.length} giriş component'i (derinlik: ${cfg.frontendDepth || 'sınırsız'})`);
    for (const entry of resolved) {
      if (!fs.existsSync(entry)) { allMissing.push(`ENTRY YOK: ${entry}`); continue; }
      const fe = scanFrontend(entry, cfg);
      fe.files.forEach(f => allFrontend.add(f));
      allMissing.push(...fe.missing);
      console.log(`      • ${path.basename(entry)} → ${fe.files.size} dosya`);
    }
    console.log(`      Toplam benzersiz frontend dosyası: ${allFrontend.size}`);

    console.log(`[2/4] API endpoint'leri çıkarılıyor...`);
    endpoints = extractEndpoints(allFrontend);
    console.log(`      ${endpoints.length} benzersiz endpoint bulundu.`);

    if (!args['no-backend'] && cfg.backendRoot && endpoints.length) {
      console.log(`[3/4] Backend indeksleniyor: ${cfg.backendRoot}`);
      const index = await indexBackend(cfg.backendRoot, cfg);
      console.log(`      ${index.files.length} .cs dosyası indekslendi.${cfg.backendIgnore.length ? ' (ignore: ' + cfg.backendIgnore.join(', ') + ')' : ''}`);
      const be = scanBackend(endpoints, index, cfg);
      be.files.forEach(f => allBackend.add(f));
      if (be.unresolved.length) {
        console.log(`      ${allBackend.size} backend dosyası (${be.unresolved.length} controller çözülemedi).`);
        var unresolvedList = be.unresolved;
      } else {
        console.log(`      ${allBackend.size} backend dosyası zincire dahil edildi.`);
      }
    } else {
      console.log(`[3/4] Backend atlandı.`);
    }
  }

  // ---- KOPYA ----
  console.log(`[son] Çıktı klasörüne kopyalanıyor: ${cfg.output}`);
  const manifest = copyFiles({ frontendFiles: [...allFrontend], backendFiles: [...allBackend] }, cfg);
  console.log(`\n✔ Bitti. ${manifest.frontend.length} frontend + ${manifest.backend.length} backend dosyası → ${path.resolve(cfg.output)}`);

  if (endpoints.length) {
    console.log(`\nEndpoint özeti:`);
    for (const ep of endpoints)
      console.log(`  ${(ep.method || 'get').toUpperCase().padEnd(6)} /${ep.controller}/${ep.action || ''}`);
  }
  if (typeof unresolvedList !== 'undefined' && unresolvedList.length) {
    console.log(`\nÇözülemeyen controller'lar:`);
    unresolvedList.forEach(u => console.log(`  - ${u}`));
  }
  if (allMissing.length && args.verbose) {
    console.log(`\nÇözülemeyen importlar:`);
    allMissing.forEach(u => console.log(`  - ${u}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
