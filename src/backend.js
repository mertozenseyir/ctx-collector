import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';

// ---------------------------------------------------------------------------
// İNDEKSLEME
// ---------------------------------------------------------------------------
export async function indexBackend(backendRoot, cfg) {
  let files = await fg('**/*.cs', {
    cwd: backendRoot,
    absolute: true,
    ignore: ['**/bin/**', '**/obj/**', '**/*.Designer.cs', '**/*.g.cs', '**/Migrations/**']
  });

  // --- IGNORE filtresi ---
  const ignore = cfg.backendIgnore || [];
  if (ignore.length) {
    // .csproj adı verilmişse o projenin klasörünü (csproj'un bulunduğu dizin) bul
    const csprojDirs = [];
    const allCsproj = await fg('**/*.csproj', { cwd: backendRoot, absolute: true, ignore: ['**/bin/**', '**/obj/**'] });
    for (const ig of ignore) {
      const nameMatch = ig.endsWith('.csproj') ? ig : ig + '.csproj';
      for (const cp of allCsproj) {
        if (path.basename(cp) === nameMatch || path.basename(cp).toLowerCase() === nameMatch.toLowerCase())
          csprojDirs.push(path.dirname(cp));
      }
    }
    files = files.filter(f => {
      // (1) yol parçası eşleşmesi
      for (const ig of ignore) {
        if (!ig.endsWith('.csproj') && f.split(path.sep).includes(ig)) return false;
        if (!ig.endsWith('.csproj') && f.includes(path.sep + ig + path.sep)) return false;
      }
      // (2) csproj klasörü altındaysa
      for (const d of csprojDirs) {
        if (f.startsWith(d + path.sep)) return false;
      }
      return true;
    });
  }

  const typeIndex = new Map();
  const fileText = new Map();
  const ifaceImpl = new Map();

  const TYPE_RE = /\b(class|interface|record|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    fileText.set(f, src);
    let m;
    TYPE_RE.lastIndex = 0;
    while ((m = TYPE_RE.exec(src))) {
      const name = m[2];
      if (!typeIndex.has(name)) typeIndex.set(name, []);
      if (!typeIndex.get(name).includes(f)) typeIndex.get(name).push(f);
    }
  }

  const CLASS_IMPL_RE = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*:\s*([^\{]+)\{/g;
  for (const f of files) {
    const src = fileText.get(f);
    let m;
    CLASS_IMPL_RE.lastIndex = 0;
    while ((m = CLASS_IMPL_RE.exec(src))) {
      const bases = m[2].split(',').map(s => s.trim().replace(/<.*$/, ''));
      for (const b of bases) {
        if (/^I[A-Z]/.test(b)) {
          if (!ifaceImpl.has(b)) ifaceImpl.set(b, []);
          if (!ifaceImpl.get(b).includes(f)) ifaceImpl.get(b).push(f);
        }
      }
    }
  }

  return { files, typeIndex, fileText, ifaceImpl };
}

// ---------------------------------------------------------------------------
// CONTROLLER BULMA
// ---------------------------------------------------------------------------
function controllerRouteName(fileName, src) {
  const cls = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)Controller\b/.exec(src);
  const base = cls ? cls[1] : path.basename(fileName).replace(/Controller\.cs$/, '');
  const routeAttr = /\[Route\(\s*"([^"]+)"\s*\)\]/.exec(src);
  if (routeAttr && !/\[controller\]/i.test(routeAttr[1]))
    return routeAttr[1].replace(/^\/+|\/+$/g, '');
  return base;
}

export function findController(controllerSeg, index, cfg) {
  const wantType = `${controllerSeg}${cfg.controllerSuffix}`;
  if (index.typeIndex.has(wantType)) return index.typeIndex.get(wantType)[0];
  const byName = index.files.find(f => path.basename(f) === wantType + '.cs');
  if (byName) return byName;
  for (const f of index.files) {
    if (!/Controller\.cs$/.test(f)) continue;
    if (controllerRouteName(f, index.fileText.get(f)).toLowerCase() === controllerSeg.toLowerCase())
      return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// METOT GÖVDESİ AYIKLAMA (isimle)
// Dönüş: verilen metot adına ait "imza + { ... }" bloğu (dengeli parantez)
// ---------------------------------------------------------------------------
function extractMethodBlock(src, methodName) {
  const nameRe = new RegExp(`\\b${methodName}\\s*(?:<[^>]*>)?\\s*\\(`, 'g');
  let m;
  while ((m = nameRe.exec(src))) {
    const braceStart = src.indexOf('{', m.index);
    const semi = src.indexOf(';', m.index);
    // interface metodu (gövdesiz, ; ile biter) — imzayı döndür
    if (semi !== -1 && (braceStart === -1 || semi < braceStart)) {
      const sigStart = src.lastIndexOf('\n', m.index) + 1;
      return src.slice(sigStart, semi + 1);
    }
    if (braceStart === -1) continue;
    let depth = 0, i = braceStart;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const sigStart = src.lastIndexOf('\n', m.index) + 1;
    return src.slice(sigStart, i);
  }
  return null;
}

// Bir kod bloğunda "_field.MethodName(" veya "svc.MethodName(" çağrılarındaki metot adlarını bul
function calledMethodNames(block) {
  const out = new Set();
  const re = /[._][A-Za-z0-9_]*\.\s*([A-Z][A-Za-z0-9_]*)\s*\(/g; // _repo.DoThing(
  let m;
  while ((m = re.exec(block))) out.add(m[1]);
  // this._x.Method() ya da x.Method() varyasyonu
  const re2 = /\b[a-z_][A-Za-z0-9_]*\.\s*([A-Z][A-Za-z0-9_]*)\s*\(/g;
  while ((m = re2.exec(block))) out.add(m[1]);
  return out;
}

function typesIn(text, index, cfg, followSuffixOnly) {
  const ids = new Set();
  const ID_RE = /\b([A-Z][A-Za-z0-9_]{2,})\b/g;
  let m;
  while ((m = ID_RE.exec(text))) {
    const id = m[1];
    if (!index.typeIndex.has(id)) continue;
    if (cfg.backendStopTypes.includes(id)) continue;
    if (followSuffixOnly) {
      const bare = /^I[A-Z]/.test(id) ? id.slice(1) : id;
      if (!cfg.backendFollowSuffixes.some(s => bare.endsWith(s))) continue;
    }
    ids.add(id);
  }
  return ids;
}

function isServiceLike(name) {
  const bare = /^I[A-Z]/.test(name) ? name.slice(1) : name;
  return ['Service', 'Repository', 'Manager', 'Handler'].some(s => bare.endsWith(s));
}
function isModelLike(name) {
  return ['Dto', 'Model', 'Entity', 'Request', 'Response', 'Command', 'Query',
          'VM', 'ViewModel', 'Detail', 'Item', 'Result', 'Info'].some(s => name.endsWith(s));
}
// service/repo/controller/interface DEĞİLSE ve index'te varsa model adayıdır.
// backendModelIncludeAll açıkken suffix konvansiyonuna bakmadan tüm proje-içi
// veri tiplerini model kabul eder.
function isModelCandidate(name, index, cfg) {
  if (!index.typeIndex.has(name)) return false;
  if (cfg.backendStopTypes.includes(name)) return false;
  if (isServiceLike(name)) return false;
  if (/^I[A-Z]/.test(name)) return false;              // arayüz
  if (/Controller$/.test(name)) return false;
  if (cfg.backendModelIncludeAll === false) return isModelLike(name);
  return true; // proje-içi, servis/arayüz/controller değil -> model say
}

// Bir metin bloğundaki tüm model-aday tiplerini bulur (new X(), dönüş, değişken, imza vs.)
function modelsInText(text, index, cfg) {
  const out = new Set();
  const ID_RE = /\b([A-Z][A-Za-z0-9_]{2,})\b/g;
  let m;
  while ((m = ID_RE.exec(text))) {
    if (isModelCandidate(m[1], index, cfg)) out.add(m[1]);
  }
  return out;
}

// Bir service dosyasında constructor DI alanı adı -> tip eşlemesi
// "private readonly IFooService _foo;" -> { _foo: 'IFooService' }
function diFieldMap(src) {
  const map = {};
  const re = /(?:private|protected|public)?\s*(?:readonly\s+)?(I[A-Z][A-Za-z0-9_]*)\s+([_a-zA-Z][A-Za-z0-9_]*)\s*;/g;
  let m;
  while ((m = re.exec(src))) map[m[2]] = m[1];
  // ctor ataması: _foo = foo;  (tip ctor parametresinden)
  const ctorParam = /(I[A-Z][A-Za-z0-9_]*)\s+([_a-zA-Z][A-Za-z0-9_]*)/g;
  while ((m = ctorParam.exec(src))) { if (!map[m[2]]) map[m[2]] = m[1]; }
  return map;
}

// ---------------------------------------------------------------------------
// ANA TARAMA — derinlik sınırlı + çağrılan-metot bazlı
// ---------------------------------------------------------------------------
export function scanBackend(endpoints, index, cfg) {
  const collected = new Set();
  const unresolved = [];
  const maxDepth = (cfg.backendServiceDepth == null) ? 2 : cfg.backendServiceDepth;

  // endpoint -> controller dosyası + action
  const byController = new Map();
  for (const ep of endpoints) {
    const cf = findController(ep.controller, index, cfg);
    if (!cf) { unresolved.push(`controller: ${ep.controller} (${ep.method} ${ep.rawPath})`); continue; }
    if (!byController.has(cf)) byController.set(cf, new Set());
    if (ep.action) byController.get(cf).add(ep.action);
  }

  // service kuyruğu: { type, methods:Set|null, depth }
  // methods=null => tüm public metotlar (fallback); methods=Set => sadece bunlar
  const queue = [];
  const seen = new Set();
  const enqueueService = (type, methods, depth) => {
    if (depth > maxDepth) return;
    const key = type + '|' + depth;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({ type, methods, depth });
  };
  const modelQueue = [];
  const modelSeen = new Set();
  const enqueueModel = (t) => { if (!modelSeen.has(t)) { modelSeen.add(t); modelQueue.push(t); } };

  // 1) CONTROLLER: sadece çağrılan action'lar
  for (const [cf, actions] of byController) {
    collected.add(cf);
    const src = index.fileText.get(cf);
    const di = diFieldMap(src);
    for (const action of actions) {
      const block = extractMethodBlock(src, action);
      if (!block) continue;
      // action gövdesinde _service.Method() çağrıları
      const methodsByField = {}; // fieldTip -> Set(metot)
      const callRe = /([_a-zA-Z][A-Za-z0-9_]*)\.\s*([A-Z][A-Za-z0-9_]*)\s*\(/g;
      let m;
      while ((m = callRe.exec(block))) {
        const field = m[1], method = m[2];
        const type = di[field];
        if (!type) continue;
        if (!methodsByField[type]) methodsByField[type] = new Set();
        methodsByField[type].add(method);
      }
      for (const [type, methods] of Object.entries(methodsByField))
        enqueueService(type, methods, 1);
      // action imza + GÖVDESİNDEKİ tüm model-aday tipler (new X(), dönüş, değişken...)
      for (const t of modelsInText(block, index, cfg)) enqueueModel(t);
    }
  }

  // 2) SERVICE BFS (derinlik sınırlı, çağrılan metot bazlı)
  while (queue.length) {
    const { type, methods, depth } = queue.shift();
    const targets = [...(index.typeIndex.get(type) || [])];
    if (/^I[A-Z]/.test(type) && index.ifaceImpl.has(type))
      targets.push(...index.ifaceImpl.get(type));

    for (const f of targets) {
      collected.add(f);
      const src = index.fileText.get(f);
      const di = diFieldMap(src);

      // İncelenecek metotlar: belirli metotlar verilmişse onlar, yoksa hepsi
      const methodBlocks = [];
      if (methods && methods.size) {
        for (const mn of methods) {
          const b = extractMethodBlock(src, mn);
          if (b) methodBlocks.push(b);
        }
      }
      // interface dosyasıysa gövde yok; implementasyona zaten targets ile gidildi.
      // hiç blok bulunamadıysa (ör. isim eşleşmedi) fallback: tüm dosya (ama derinlik artışında)
      const scanText = methodBlocks.length ? methodBlocks.join('\n') : '';

      // bu metotlardaki alt-servis çağrıları -> bir derin
      if (scanText) {
        const methodsByField = {};
        const callRe = /([_a-zA-Z][A-Za-z0-9_]*)\.\s*([A-Z][A-Za-z0-9_]*)\s*\(/g;
        let m;
        while ((m = callRe.exec(scanText))) {
          const field = m[1], method = m[2];
          const t = di[field];
          if (!t) continue;
          if (!methodsByField[t]) methodsByField[t] = new Set();
          methodsByField[t].add(method);
        }
        for (const [t, ms] of Object.entries(methodsByField))
          enqueueService(t, ms, depth + 1);
        // metot gövdelerindeki tüm model-aday tipler
        for (const t of modelsInText(scanText, index, cfg)) enqueueModel(t);
      } else {
        // metot bulunamadıysa sadece imza satırlarındaki modelleri al (gövde tarama yok)
        const sigLines = (src.match(/^[^{}]*\([^)]*\)/gm) || []).join("\n");
        for (const t of modelsInText(sigLines, index, cfg)) enqueueModel(t);
      }
    }
  }

  // 3) MODEL zinciri: model dosyasının property/alan tiplerini bir kademe takip et.
  //    Konvansiyona uymayan iç içe modeller de yakalanır. Service'e sıçramaz
  //    (isModelCandidate service/arayüz/controller'ı zaten eler).
  while (modelQueue.length) {
    const t = modelQueue.shift();
    for (const f of (index.typeIndex.get(t) || [])) {
      collected.add(f);
      const src = index.fileText.get(f);
      // property/alan satırlarındaki tipler
      const propRe = /\b(?:public|internal|protected)\s+([A-Za-z0-9_<>,\[\]\?\.]+)\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:\{|;|=>|=)/g;
      let m;
      while ((m = propRe.exec(src))) {
        for (const pt of modelsInText(m[1], index, cfg)) enqueueModel(pt);
      }
      // kalıtım: "class X : BaseDto" -> base tipini de al
      const baseM = /\bclass\s+[A-Za-z0-9_]+\s*(?:<[^>]*>)?\s*:\s*([^\{]+)\{/.exec(src);
      if (baseM) for (const pt of modelsInText(baseM[1], index, cfg)) enqueueModel(pt);
    }
  }

  return { files: collected, unresolved };
}

// ---------------------------------------------------------------------------
// BACKEND-ONLY MOD
// Bir service dosyasından başlayıp:
//  - bu service'i kullanan controller'ları bulur (ters arama)
//  - service'in kendi zincirini (alt service/repo/dto) toplar
//  - controller'lardan endpoint URL'leri türetir (frontend ters araması için)
// ---------------------------------------------------------------------------

// Bir dosyadaki ilk sınıf/arayüz adını döndürür
function primaryTypeName(src) {
  const m = /\b(?:class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(src);
  return m ? m[1] : null;
}

// Bir service tipini (IFoo veya Foo) hangi controller'lar DI ile kullanıyor?
function controllersUsingType(typeName, index) {
  const bareForms = new Set([typeName]);
  if (/^I[A-Z]/.test(typeName)) bareForms.add(typeName.slice(1));
  else bareForms.add('I' + typeName);
  const out = [];
  for (const f of index.files) {
    if (!/Controller\.cs$/.test(f)) continue;
    const src = index.fileText.get(f);
    for (const bf of bareForms) {
      const re = new RegExp(`\\b${bf}\\b`);
      if (re.test(src)) { out.push(f); break; }
    }
  }
  return out;
}

// Bir controller dosyasından tüm endpoint'leri (controller segmenti + action + method) çıkarır
function endpointsFromController(cf, index, cfg) {
  const src = index.fileText.get(cf);
  const controllerSeg = controllerRouteName(cf, src);
  const eps = [];
  // her [Route("Action...")] + ardından gelen [HttpGet/Post/...] veya metot
  const routeRe = /\[Route\("([^"]+)"\)\]/g;
  let m;
  while ((m = routeRe.exec(src))) {
    const raw = m[1];
    // sınıf düzeyi route ([controller] ya da sabit prefix) endpoint değil, atla
    if (/\[controller\]/i.test(raw)) continue;
    let actionPath = raw.replace(/\{[^}]*\}/g, '').replace(/^\/+|\/+$/g, '');
    const action = actionPath.split('/')[0] || null;
    const after = src.slice(m.index, m.index + 300);
    const hm = /\[Http(Get|Post|Put|Delete|Patch)\]/i.exec(after);
    const method = hm ? hm[1].toLowerCase() : 'get';
    if (action) eps.push({ controller: controllerSeg, action, method });
  }
  return eps;
}

/**
 * Backend-only giriş: service dosyaları -> zincir + controller'lar.
 * Döner: { files:Set, endpoints:[...], controllers:[...], unresolved:[] }
 */
export function scanBackendFromServices(serviceFiles, index, cfg) {
  const collected = new Set();
  const endpoints = [];
  const epSeen = new Set();
  const controllerFiles = new Set();

  for (const sf of serviceFiles) {
    if (!index.fileText.has(sf)) {
      // indeks dışında (ör. ignore edilmiş) -> yine de oku
      if (fs.existsSync(sf)) index.fileText.set(sf, fs.readFileSync(sf, 'utf8'));
      else continue;
    }
    collected.add(sf);
    const src = index.fileText.get(sf);
    const typeName = primaryTypeName(src);
    if (!typeName) continue;

    // 1) bu service'i kullanan controller'lar
    const ctrls = controllersUsingType(typeName, index);
    for (const cf of ctrls) {
      controllerFiles.add(cf);
      collected.add(cf);
      // controller'ın endpoint'leri (frontend ters araması + tam zincir için)
      for (const ep of endpointsFromController(cf, index, cfg)) {
        const key = `${ep.controller}|${ep.action}|${ep.method}`;
        if (!epSeen.has(key)) { epSeen.add(key); endpoints.push(ep); }
      }
    }
  }

  // 2) endpoint'lerden normal backend zincirini çalıştır (service/repo/dto toplar)
  //    Böylece verilen service + kardeş bağımlılıklar da gelir.
  if (endpoints.length) {
    const chain = scanBackend(endpoints, index, cfg);
    chain.files.forEach(f => collected.add(f));
  }

  return {
    files: collected,
    endpoints,
    controllers: [...controllerFiles],
    unresolved: []
  };
}
