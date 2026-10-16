/* Service worker: guarda o app no celular para funcionar sem internet (inclusive a leitura dos recibos).
   Ao publicar uma nova versão, aumente VERSAO para que os celulares baixem os arquivos novos. */
const VERSAO = 'v1.5.0';
const CACHE_APP = 'reembolso-app-' + VERSAO;
const CACHE_OCR = 'reembolso-ocr-v5.1.1';

const ARQUIVOS_APP = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'template.xlsx',
  'js/db.js',
  'js/leitura.js',
  'js/exportar.js',
  'js/app.js',
  'vendor/jszip.min.js',
  'vendor/jspdf.umd.min.js',
  'vendor/jsQR.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

// Detecta suporte a SIMD para baixar só a versão do OCR que este celular usa
function temSIMD() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch (e) {
    return false;
  }
}

function arquivosOCR() {
  return [
    'vendor/tesseract/tesseract.min.js',
    'vendor/tesseract/worker.min.js',
    'vendor/tesseract/lang/por.traineddata.gz',
    'vendor/heic2any.min.js',
    temSIMD() ? 'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js' : 'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  ];
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const app = await caches.open(CACHE_APP);
    await app.addAll(ARQUIVOS_APP.map(u => new Request(u, { cache: 'reload' })));
    // OCR e conversor HEIC são grandes (~6 MB): se falhar agora, são baixados no primeiro uso
    try {
      const ocr = await caches.open(CACHE_OCR);
      for (const u of arquivosOCR()) {
        if (!(await ocr.match(u))) await ocr.add(u);
      }
    } catch (e) { /* segue sem OCR offline */ }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome !== CACHE_APP && nome !== CACHE_OCR) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'atualizar') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const emCache = await caches.match(req, { ignoreSearch: true });
    if (emCache) return emCache;
    const resp = await fetch(req);
    // guarda os arquivos grandes (OCR, conversor HEIC) na primeira vez que forem usados
    if (resp.ok && req.url.includes('/vendor/')) {
      const copia = resp.clone();
      caches.open(CACHE_OCR).then(c => c.put(req, copia)).catch(() => {});
    }
    return resp;
  })().catch(async () => {
    if (req.mode === 'navigate') {
      const inicio = await caches.match('index.html');
      if (inicio) return inicio;
    }
    return Response.error();
  }));
});
