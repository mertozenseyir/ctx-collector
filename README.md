# ctx-collect

Bir modülün bağımlı dosyalarını (frontend + backend) tek çıktı klasöründe toplar,
böylece hepsini tek seferde Claude'a verebilirsin. İki çalışma modu var:

**Normal mod (frontend'den başla):** Bir Angular component'inden başlar,
1. `import` zincirini takip ederek bağımlı component/service/model/template dosyalarını toplar,
2. Bu dosyalardaki `this.http.get/post/...` çağrılarından API endpoint'lerini çıkarır,
3. .NET tarafında endpoint'e karşılık gelen controller'ı bulur ve
   controller → service (interface+impl) → repository → model/dto zincirini izler,
4. Hepsini tek çıktı klasörüne kopyalar.

**Backend-only mod (service'ten başla):** İşin sadece backend tarafı olduğunda
bir service dosyasından başlar; service'i kullanan controller'ları ve alt zincirini
bulur, istersen UI'da o endpoint'leri kullanan component'leri de ters aramayla çıkarır.

Çıktı: `output/frontend/` ve `output/backend/` altında dosyalar DÜZ (klasörsüz)
kopyalanır. Aynı isimli dosya birden çok klasörde çıkarsa yalnızca ilki alınır,
sonrakiler atlanır (atlananlar `_manifest.json`'daki `skipped` listesine yazılır).
`output/_manifest.json` her
dosyanın orijinal yolunu tutar.

## Kurulum
```
npm install
```
Gereksinim: Node.js (LTS önerilir). `npm link` ile global `ctx-collect` komutu opsiyoneldir.

## Hızlı kullanım
En pratiği: `ctx-collect.config.json` dosyasını doldurup argümansız çalıştırmak.
```
node src/index.js
```

> **Önemli:** Depoyla gelen `ctx-collect.config.json` içindeki değerler rastgele
> örneklerdir (örn. `C:/Users/johndoe/source/AcmeShop-UI`). İlk kullanımda
> `frontendRoot`, `backendRoot`, `entries` ve `backendIgnore` alanlarını kendi
> yollarınla değiştir. `aliases`'ı Angular projenin `tsconfig.json` `paths`'ine göre ayarla
> (paths yoksa varsayılanı bırak).

## Normal mod
```
node src/index.js <component.ts> [<component2.ts> ...] \
  --frontendRoot /yol/angular-repo \
  --backendRoot  /yol/dotnet-repo \
  --output ./output
```
Birden fazla component verilebilir; hepsinin bağımlılıkları ve endpoint'leri
birleştirilip tek çıktıya toplanır. Config'te `entries` dizisi de aynı işi görür;
komut satırında dosya verirsen config'teki `entries` yok sayılır.

## Backend-only mod
```
node src/index.js --backend-entry <Service.cs> [--with-ui | --no-ui]
```
veya config'e `backendEntries` dizisi yazıp argümansız çalıştır. Bu mod:
- service'i kullanan controller'ları bulur,
- service → repository → dto zincirini toplar,
- `--with-ui` (varsayılan AÇIK) ile o endpoint'lere giden frontend servis +
  component'lerini ters aramayla bulup onları da toplar; `--no-ui` ile kapatılır.

Mod seçimi otomatik: komut satırında component verirsen normal mod; vermezsen ve
`backendEntries` (ya da `--backend-entry`) doluysa backend-only mod çalışır.

## Komut satırı seçenekleri
```
--frontendRoot <yol>   Angular repo kökü (src içeren)
--backendRoot <yol>    .NET repo kökü
--output <yol>         Çıktı klasörü (varsayılan ./output)
--backend-entry <.cs>  Backend-only giriş (çok kez verilebilir)
--frontendDepth <n>    Frontend import derinliği (0 = sınırsız)
--ignore <proje>       Backend'de yok sayılacak proje/yol (çok kez verilebilir)
--with-ui / --no-ui    Backend-only modda UI ters aramasını aç / kapa
--no-backend           Normal modda backend'i atla
--verbose              Çözülemeyen importları da yaz
--help
```

## Config (ctx-collect.config.json)
Çalışma dizinine koyarsan CLI bayraklarına gerek kalmaz. Alanlar:

- `frontendRoot`, `backendRoot`, `output` — repo kökleri ve çıktı klasörü.
- `entries` — normal mod giriş component'leri (dizi). Göreli yollar `frontendRoot`'a göre çözülür.
- `backendEntries` — backend-only giriş service dosyaları (dizi). Doluysa backend-only moda geçer.
- `backendOnlyIncludeUi` — backend-only modda UI ters aramasını yap (varsayılan `true`).
- `aliases` — tsconfig `paths` karşılığı. Örn `"@app/": "src/app/"`. **Projenin gerçek
  tsconfig paths'ine göre doldur** — çözülemeyen import sayısı yüksekse sebebi genelde budur.
  `paths` yoksa varsayılanı bırak.
- `frontendDepth` — frontend import zinciri derinliği. `0` = sınırsız, `1` = sadece
  giriş component'inin doğrudan importları.
- `backendServiceDepth` — bir service'ten alt service/repository'ye kaç kademe inilir
  (varsayılan `2`). Service içinde SADECE çağrılan endpoint metotlarının kullandığı
  alt-servisler izlenir; kullanılmayan metotlardaki bağımlılıklar (örn. yalnız başka
  bir metotta geçen `CityRepository`) alınmaz. Çıktı hâlâ fazlaysa `1`'e düşür.
- `backendIgnore` — aynı solution'daki başka API projelerini dışla. İki eşleşme türü:
  yol parçası (`"NgMobile.API"` → yolunda bu klasör geçen tüm .cs atlanır) veya
  .csproj adı (`"NgMobile.API.csproj"` → o projenin klasörü komple atlanır).
- `ignoreImportPrefixes` — 3rd party import önekleri (atlanır).
- `backendFollowSuffixes` — zincirde SADECE bu eklerle biten tipler izlenir
  (Service, Repository, Dto, Model, Request, Response...). Ortak tiplerin tüm repoyu
  çekmesini önler.
- `backendStopTypes` — hiçbir zaman izlenmeyecek altyapı tipleri (ApiResponse vb.).

## Notlar / sınırlar
- Endpoint eşleşmesi `[Route("[controller]")]` konvansiyonu + metot `[Route("Action")]`
  üzerine kurulu. Sabit route prefix'li controller'lar route string'iyle eşlenir.
- Çözülemeyen controller/endpoint ve importlar çalışma sonunda rapor edilir;
  bunları `aliases`, `backendServiceDepth` ve `backendIgnore` ile azaltabilirsin.
- Çıktı beklenenden fazlaysa `_manifest.json`'daki `source` yollarına bakarak hangi
  dosyanın nereden geldiğini görebilirsin.
