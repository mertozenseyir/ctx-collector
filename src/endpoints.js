import fs from 'fs';

const HTTP_CALL_RE = /\.\s*(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*([`'"])([\s\S]*?)\2/g;

// URL string -> { controller, action }
// Kural: `${environment.apiUrl}` (veya benzeri base placeholder) ilk parçadır ve atılır.
// Ondan sonraki İLK path segmenti = controller, İKİNCİ = action.
// Query string, {id} interpolasyonu ve trailing slash temizlenir.
function parseUrl(raw) {
  // query string at
  let s = raw.split('?')[0];
  // base placeholder'ı at: ${...} ile başlıyorsa ilk ${...}'i sil
  s = s.replace(/^\s*\$\{[^}]*\}/, '');
  // kalan ${...} interpolasyonları (path param) -> boşluk placeholder
  s = s.replace(/\$\{[^}]*\}/g, '\x00');
  const parts = s.split('/').map(p => p.trim()).filter(p => p && p !== '\x00');
  if (parts.length === 0) return null;
  // İlk segment hâlâ base kalıntısıysa (nadiren) yine ilk anlamlı olanı al
  const controller = parts[0];
  // action: ikinci segment, placeholder değilse
  let action = null;
  if (parts[1] && !parts[1].includes('\x00')) action = parts[1];
  return { controller, action, rawPath: parts.join('/') };
}

export function extractEndpoints(files) {
  const endpoints = [];
  const seen = new Set();
  for (const file of files) {
    if (!/\.ts$/.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    let m;
    HTTP_CALL_RE.lastIndex = 0;
    while ((m = HTTP_CALL_RE.exec(src))) {
      const method = m[1];
      const rawUrl = m[3];
      // sadece apiUrl tabanlı çağrılar (dış tam URL'leri atla)
      if (!/\$\{[^}]*apiUrl[^}]*\}/i.test(rawUrl) && !rawUrl.startsWith('/')) continue;
      const parsed = parseUrl(rawUrl);
      if (!parsed || !parsed.controller) continue;
      const key = `${parsed.controller}|${parsed.action}|${method}`;
      if (seen.has(key)) continue;
      seen.add(key);
      endpoints.push({ ...parsed, method, sourceFile: file });
    }
  }
  return endpoints;
}
