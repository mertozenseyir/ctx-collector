import fs from 'fs';
import path from 'path';

// Varsayılan config. ctx-collect.config.json ile override edilebilir.
export const DEFAULT_CONFIG = {
  // Giriş component(ler)i. Tek string ya da dizi olabilir.
  // Komut satırında dosya verilmezse buradaki liste kullanılır.
  // Örn: ["src/app/x/x.component.ts", "src/app/y/y.component.ts"]
  // Göreli yollar frontendRoot'a göre çözülür.
  entries: [],

  // Backend-only giriş(ler)i: bir service dosyası verip backend zincirini + (opsiyonel)
  // UI'da kullanan component'leri bulmak için. Tek string ya da dizi.
  // Dolu ise araç backend-only moda geçer.
  backendEntries: [],

  // Backend-only modda, servisin UI'da kullanıldığı component'leri de bul (ters arama).
  // --with-ui / --no-ui bayraklarıyla da açılıp kapanır.
  backendOnlyIncludeUi: true,

  // Frontend import zincirinde kaç kademe derine inilsin.
  // 0 = sınırsız (tüm zincir). 1 = sadece giriş dosyasının doğrudan importları. vb.
  frontendDepth: 0,

  // Angular repo kökü (src klasörünü içeren)
  frontendRoot: '',
  // .NET repo kökü (Controllers/Services/... içeren)
  backendRoot: '',
  // Çıktı klasörü
  output: './output',

  // Frontend import alias eşlemeleri. tsconfig paths mantığı.
  // 'src/app/...' -> <frontendRoot>/src/app/...
  aliases: {
    'src/': 'src/',
    '@app/': 'src/app/',
    '@env/': 'src/environments/',
    '@shared/': 'src/app/shared/'
  },

  // Import çözümünde denenecek uzantılar
  extensions: ['.ts', '.html', '.scss', '.css', '.json'],

  // Bir .ts import edilince yanındaki .html/.scss dosyaları da alınsın mı
  pullSiblingTemplates: true,

  // Node/3rd party importları atla (bunlarla başlayanlar dosya değil)
  ignoreImportPrefixes: ['@angular/', 'rxjs', '@ngx-', 'devextreme', 'lodash'],

  // Backend: controller URL segmenti -> "<segment>Controller.cs" araması
  controllerSuffix: 'Controller',

  // Backend indekslemesinde YOK SAYILACAK projeler/yollar.
  // İki şekilde eşleşir: (1) dosya yolunda bu metin geçiyorsa (ör. "NgMobile.API"),
  // (2) .csproj adıyla (ör. "NgMobile.API.csproj" -> o projenin klasörü komple atlanır).
  // Örn: ["NgMobile.API", "Internal.API"]
  backendIgnore: [],

  // Backend zincirinde takip edilecek DI arayüz önekleri (I...Service, I...Repository)
  // Bunların implementasyonu ve modelleri de toplanır.
  backendFollowInterfaces: true,

  // Backend tarafında toplanacak dosya türleri için klasör ipuçları (opsiyonel filtre yok, tüm repo taranır)
  backendMaxDepth: 4,

  // Backend zincirinde SADECE adı bu eklerden biriyle biten tipler takip edilir.
  // Bu, ApiResponse/Ok/Exception gibi ortak framework tiplerinin tüm repoyu
  // çekmesini engeller. Boş bırakılırsa tüm indekslenen tipler takip edilir.
  backendFollowSuffixes: [
    'Service', 'Repository', 'Dto', 'Model', 'Entity',
    'Request', 'Response', 'Manager', 'Helper', 'Mapper',
    'Command', 'Query', 'Handler', 'Validator'
  ],

  // Model/DTO toplama: true ise (varsayılan) isim konvansiyonuna bakmadan,
  // zincirde işlenen metotların gövde+imzasında geçen HER proje-içi veri tipini
  // (service/repo/controller/arayüz hariç) model olarak toplar. false ise sadece
  // backendFollowSuffixes/Dto/Model gibi konvansiyona uyan tipler alınır.
  backendModelIncludeAll: true,

  // Backend zincirinde bir service'ten alt-service'e kaç kademe inilsin.
  // 1 = controller→service→repository (dur). 2 = bir kademe daha. Yüksek = daha çok dosya.
  backendServiceDepth: 2,

  // Bu tam adlar zincirde asla takip edilmez (ortak altyapı tipleri).
  backendStopTypes: [
    'ApiResponse', 'NoData', 'RequestSource', 'AuthUser', 'LogTypes',
    'LogLevel', 'NeptuneTables', 'Roles', 'Exception', 'JsonSerializer',
    'ControllerBase', 'IActionResult', 'ActionResult', 'IHttpContextAccessor'
  ]
};

export function loadConfig(cliOverrides = {}) {
  let fileCfg = {};
  const cfgPath = path.resolve(process.cwd(), 'ctx-collect.config.json');
  if (fs.existsSync(cfgPath)) {
    fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
  const cfg = { ...DEFAULT_CONFIG, ...fileCfg, ...cliOverrides };
  cfg.aliases = { ...DEFAULT_CONFIG.aliases, ...(fileCfg.aliases || {}), ...(cliOverrides.aliases || {}) };
  return cfg;
}
