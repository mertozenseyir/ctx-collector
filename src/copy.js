import fs from 'fs';
import path from 'path';

/**
 * Dosyaları çıktı klasörüne DÜZ (klasörsüz) kopyalar.
 * frontend/ ve backend/ iki üst klasör altında toplanır, içleri düz.
 * Aynı isim çakışırsa dosyaadı_2.ext, _3.ext ... diye numaralandırır.
 */
export function copyFiles({ frontendFiles, backendFiles }, cfg) {
  const outRoot = path.resolve(cfg.output);
  if (fs.existsSync(outRoot)) {
    // Node 12/14 uyumu: rmSync yerine rmdirSync recursive
    try { fs.rmSync(outRoot, { recursive: true, force: true }); }
    catch (e) { fs.rmdirSync(outRoot, { recursive: true }); }
  }
  fs.mkdirSync(outRoot, { recursive: true });

  const manifest = { frontend: [], backend: [], skipped: [] };

  const doCopy = (files, subdir, bucket) => {
    const dir = path.join(outRoot, subdir);
    fs.mkdirSync(dir, { recursive: true });
    const used = new Set(); // kullanılmış dosya adları (küçük harf)

    for (const f of files) {
      const name = path.basename(f);
      const key = name.toLowerCase();
      if (used.has(key)) {
        // aynı isim daha önce kopyalandı -> pas geç, ilk gelen kalır
        manifest.skipped.push({ name, source: f });
        continue;
      }
      used.add(key);
      const dest = path.join(dir, name);
      fs.copyFileSync(f, dest);
      manifest[bucket].push({ file: path.join(subdir, name), source: f });
    }
  };

  doCopy(frontendFiles, 'frontend', 'frontend');
  doCopy(backendFiles, 'backend', 'backend');

  fs.writeFileSync(path.join(outRoot, '_manifest.json'), JSON.stringify(manifest, null, 2));
  return { frontend: manifest.frontend.map(x => x.file), backend: manifest.backend.map(x => x.file) };
}
