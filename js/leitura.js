/* Leitura do recibo: QR code da nota (NFC-e / SAT) + OCR do texto (Tesseract, roda no próprio celular).
   Tudo aqui é sugestão: o usuário confere e corrige antes de salvar. */
const Leitura = (() => {
  const BASE = new URL('./', location.href).href;
  const scripts = {};

  function carregarScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolver, rejeitar) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolver;
        s.onerror = () => { delete scripts[src]; s.remove(); rejeitar(new Error('Falha ao carregar ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  // ---------- Imagem ----------
  const dims = img => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });

  function abrirComImg(blob) {
    return new Promise((resolver, rejeitar) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolver({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); rejeitar(new Error('decodificação falhou')); };
      img.src = url;
    });
  }

  // Fotos HEIC/HEIF (padrão de muitos Android e iPhone) não abrem no Chrome: detecta pelo cabeçalho do arquivo
  async function ehHEIC(arquivo) {
    if (/hei[cf]/i.test(arquivo.type) || /\.hei[cf]$/i.test(arquivo.name || '')) return true;
    const cab = new Uint8Array(await blobParaBuffer(arquivo.slice(0, 64)));
    const txt = String.fromCharCode.apply(null, cab);
    if (txt.slice(4, 8) !== 'ftyp') return false;
    const marca = txt.slice(8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|hevm|hevs)$/.test(marca)) return true;
    return /^(mif1|msf1)$/.test(marca) && txt.includes('hei') && !txt.includes('avif');
  }

  function blobParaBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise((resolver, rejeitar) => {
      const r = new FileReader();
      r.onload = () => resolver(r.result);
      r.onerror = () => rejeitar(r.error);
      r.readAsArrayBuffer(blob);
    });
  }

  async function carregarImagem(arquivo, aoAvisar) {
    const info = `${arquivo.type || 'formato desconhecido'}, ${(arquivo.size / 1048576).toFixed(1)} MB`;
    if (!arquivo.size) {
      throw new Error('A foto escolhida veio vazia (pode estar só na nuvem). Abra a foto na galeria para baixá-la e tente de novo.');
    }
    try {
      return await abrirComImg(arquivo);
    } catch (e) { /* tenta os outros caminhos */ }
    if (await ehHEIC(arquivo)) {
      if (aoAvisar) aoAvisar('Convertendo a foto (formato HEIC)…');
      try {
        await carregarScript('vendor/heic2any.min.js');
        let jpeg = await window.heic2any({ blob: arquivo, toType: 'image/jpeg', quality: 0.92 });
        if (Array.isArray(jpeg)) jpeg = jpeg[0];
        return await abrirComImg(jpeg);
      } catch (e) {
        console.warn('HEIC', e);
        throw new Error(`Não foi possível converter esta foto HEIC (${info}). Dica: abra a foto na galeria, tire um print da tela e envie o print.`);
      }
    }
    // Último recurso (ex.: foto gigante de 100+ megapixels): decodifica já reduzida
    for (const opcoes of [undefined, { resizeWidth: 3000, resizeQuality: 'high' }]) {
      try {
        if (window.createImageBitmap) return { img: await createImageBitmap(arquivo, opcoes), url: null };
      } catch (e) { /* tenta a próxima */ }
    }
    throw new Error(`Não foi possível abrir esta imagem (${info}). Dica: abra a foto na galeria, tire um print da tela e envie o print.`);
  }

  function desenhar(img, maxLado, recorte) {
    const r = recorte || { x: 0, y: 0, w: dims(img).w, h: dims(img).h };
    const escala = Math.min(1, maxLado / Math.max(r.w, r.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * escala));
    c.height = Math.max(1, Math.round(r.h * escala));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }

  function canvasParaBlob(c, qualidade) {
    return new Promise((resolver, rejeitar) => {
      c.toBlob(b => (b ? resolver(b) : rejeitar(new Error('Falha ao processar a foto.'))), 'image/jpeg', qualidade);
    });
  }

  function limiarOtsu(hist, n) {
    let soma = 0;
    for (let v = 0; v < 256; v++) soma += v * hist[v];
    let sB = 0, wB = 0, melhorVar = 0, limiar = 128;
    for (let v = 0; v < 256; v++) {
      wB += hist[v];
      if (!wB) continue;
      const wF = n - wB;
      if (!wF) break;
      sB += v * hist[v];
      const dif = sB / wB - (soma - sB) / wF;
      const vr = wB * wF * dif * dif;
      if (vr > melhorVar) { melhorVar = vr; limiar = v; }
    }
    return limiar;
  }

  // Pinta de branco o fundo escuro (mesa) que encosta nas bordas do recorte: as faixas escuras
  // ao redor da nota confundem o OCR. O texto não encosta na borda, então fica intacto.
  function apagarFundo(p, w, h) {
    const n = w * h;
    const hist = new Uint32Array(256);
    for (let k = 0; k < n; k++) hist[p[k * 4]]++;
    const limiar = limiarOtsu(hist, n);
    const visto = new Uint8Array(n);
    const fila = new Int32Array(n);
    let ini = 0, fim = 0;
    const semear = k => {
      if (!visto[k] && p[k * 4] <= limiar) { visto[k] = 1; fila[fim++] = k; }
    };
    for (let x = 0; x < w; x++) { semear(x); semear((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { semear(y * w); semear(y * w + w - 1); }
    while (ini < fim) {
      const k = fila[ini++];
      const x = k % w;
      if (x > 0) semear(k - 1);
      if (x < w - 1) semear(k + 1);
      if (k >= w) semear(k - w);
      if (k < n - w) semear(k + w);
    }
    for (let k = 0; k < n; k++) if (visto[k]) p[k * 4] = p[k * 4 + 1] = p[k * 4 + 2] = 255;
  }

  // Acha a nota na foto: maior região clara (papel) contra o fundo (mesa). Devolve null se não der para separar.
  function localizarNota(img) {
    const { w: W0, h: H0 } = dims(img);
    const esc = Math.min(1, 400 / Math.max(W0, H0));
    const w = Math.max(1, Math.round(W0 * esc)), h = Math.max(1, Math.round(H0 * esc));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const p = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const cinza = new Uint8Array(n);
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const y = (p[i * 4] * 299 + p[i * 4 + 1] * 587 + p[i * 4 + 2] * 114) / 1000 | 0;
      cinza[i] = y;
      hist[y]++;
    }
    // limiar de Otsu separa papel (claro) de fundo (escuro)
    const limiar = limiarOtsu(hist, n);
    // maior componente conectado de pixels claros
    const visto = new Uint8Array(n);
    const fila = new Int32Array(n);
    let maior = null;
    for (let s = 0; s < n; s++) {
      if (visto[s] || cinza[s] <= limiar) continue;
      let ini = 0, fim = 0, qtd = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
      fila[fim++] = s;
      visto[s] = 1;
      while (ini < fim) {
        const k = fila[ini++];
        const x = k % w, y = (k / w) | 0;
        qtd++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x > 0 && !visto[k - 1] && cinza[k - 1] > limiar) { visto[k - 1] = 1; fila[fim++] = k - 1; }
        if (x < w - 1 && !visto[k + 1] && cinza[k + 1] > limiar) { visto[k + 1] = 1; fila[fim++] = k + 1; }
        if (y > 0 && !visto[k - w] && cinza[k - w] > limiar) { visto[k - w] = 1; fila[fim++] = k - w; }
        if (y < h - 1 && !visto[k + w] && cinza[k + w] > limiar) { visto[k + w] = 1; fila[fim++] = k + w; }
      }
      if (!maior || qtd > maior.qtd) maior = { qtd, x0, y0, x1, y1 };
    }
    if (!maior) return null;
    const frac = ((maior.x1 - maior.x0 + 1) * (maior.y1 - maior.y0 + 1)) / n;
    if (frac < 0.08 || frac > 0.9) return null; // nota ocupa a foto toda (ou não achou): usa a foto inteira
    const m = 0.02 * Math.max(w, h);
    const x = Math.max(0, (maior.x0 - m) / esc), y = Math.max(0, (maior.y0 - m) / esc);
    return { x, y, w: Math.min(W0, (maior.x1 + 1 + m) / esc) - x, h: Math.min(H0, (maior.y1 + 1 + m) / esc) - y };
  }

  // Recorta a nota, amplia para ~1600 px de largura e passa para tons de cinza com contraste esticado.
  function prepararParaOCR(img) {
    const { w: W0, h: H0 } = dims(img);
    const r = localizarNota(img) || { x: 0, y: 0, w: W0, h: H0 };
    let esc = 1600 / r.w;
    if (r.h * esc > 4200) esc = 4200 / r.h;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * esc));
    c.height = Math.max(1, Math.round(r.h * esc));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    const dados = ctx.getImageData(0, 0, c.width, c.height);
    const p = dados.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < p.length; i += 4) {
      const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0;
      p[i] = y;
      hist[y]++;
    }
    const total = p.length / 4;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break; } }
    const escala = hi > lo + 10 ? 255 / (hi - lo) : 1;
    const base = hi > lo + 10 ? lo : 0;
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.max(0, Math.min(255, (p[i] - base) * escala));
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    apagarFundo(p, c.width, c.height);
    ctx.putImageData(dados, 0, 0);
    return c;
  }

  // ---------- QR code ----------
  async function lerQR(img) {
    if ('BarcodeDetector' in window) {
      try {
        const formatos = await BarcodeDetector.getSupportedFormats();
        if (formatos.includes('qr_code')) {
          const achados = await new BarcodeDetector({ formats: ['qr_code'] }).detect(img);
          if (achados.length) return achados[0].rawValue;
          return '';
        }
      } catch (e) { /* cai para o jsQR */ }
    }
    await carregarScript('vendor/jsQR.js');
    for (const maxLado of [1000, 1600, 2400]) {
      const c = desenhar(img, maxLado);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const r = window.jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
      c.width = c.height = 0;
      if (r && r.data) return r.data;
      if (Math.max(dims(img).w, dims(img).h) <= maxLado) break;
    }
    return '';
  }

  const centavos = s => Math.round(parseFloat(s) * 100);

  function interpretarQR(texto) {
    const r = { link: '' };
    const t = (texto || '').trim();
    if (!t) return r;
    if (/^https?:\/\//i.test(t)) {
      r.link = t;
      let u = null;
      try { u = new URL(t); } catch (e) { return r; }
      const p = u.searchParams.get('p');
      if (p) {
        const partes = p.split('|');
        if (/^\d{44}$/.test(partes[0])) r.chave = partes[0];
        // Emissão em contingência: chave|versão|ambiente|dia|valor|...
        if (partes.length >= 7 && /^\d{1,2}$/.test(partes[3]) && /^\d+(\.\d{1,2})?$/.test(partes[4])) {
          r.dia = parseInt(partes[3], 10);
          r.valor = centavos(partes[4]);
        }
      }
      const ch = u.searchParams.get('chNFe');
      if (ch && /^\d{44}$/.test(ch)) r.chave = ch;
      const vNF = u.searchParams.get('vNF');
      if (vNF && /^\d+(\.\d{1,2})?$/.test(vNF)) r.valor = centavos(vNF);
      const dh = u.searchParams.get('dhEmi');
      if (dh && /^[0-9a-f]+$/i.test(dh) && dh.length % 2 === 0) {
        let s = '';
        for (let i = 0; i < dh.length; i += 2) s += String.fromCharCode(parseInt(dh.slice(i, i + 2), 16));
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (m) { r.data = `${m[1]}-${m[2]}-${m[3]}`; r.hora = `${m[4]}:${m[5]}`; }
      }
    } else {
      // CF-e SAT (SP): chave|AAAAMMDDhhmmss|valor|CPF|assinatura
      const m = t.match(/^(\d{44})\|(\d{14})\|(\d+(?:\.\d{1,2})?)\|/);
      if (m) {
        r.chave = m[1];
        r.data = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}`;
        r.hora = `${m[2].slice(8, 10)}:${m[2].slice(10, 12)}`;
        r.valor = centavos(m[3]);
        r.link = 'Chave CF-e SAT: ' + m[1];
      }
    }
    if (r.chave) {
      r.ano = 2000 + parseInt(r.chave.slice(2, 4), 10);
      r.mes = parseInt(r.chave.slice(4, 6), 10);
    }
    return r;
  }

  // ---------- OCR ----------
  let worker = null;
  let aoProgredirAtual = null;
  let timerEncerrar = null;

  function obterWorker() {
    if (!worker) {
      worker = (async () => {
        await carregarScript('vendor/tesseract/tesseract.min.js');
        const w = await window.Tesseract.createWorker('por', 1, {
          workerPath: BASE + 'vendor/tesseract/worker.min.js',
          corePath: BASE + 'vendor/tesseract/core',
          langPath: BASE + 'vendor/tesseract/lang',
          workerBlobURL: false,
          logger: m => { if (aoProgredirAtual) aoProgredirAtual(m); },
        });
        return w;
      })();
      worker.catch(() => { worker = null; });
    }
    return worker;
  }

  async function encerrarWorker() {
    const w = worker;
    worker = null;
    if (w) { try { (await w).terminate(); } catch (e) { /* ignora */ } }
  }

  // 1ª leitura: limiar global (rápida, boa para nota lisa). 2ª: limiar local (Sauvola), que aguenta
  // sombra e papel amassado; só roda se a 1ª não tiver certeza do total.
  const MODOS = [
    { tessedit_pageseg_mode: '6', thresholding_method: '0', preserve_interword_spaces: '1' },
    { tessedit_pageseg_mode: '6', thresholding_method: '2', preserve_interword_spaces: '1' },
  ];

  async function reconhecer(c, modo, aoProgredir) {
    clearTimeout(timerEncerrar);
    aoProgredirAtual = aoProgredir;
    let tempo;
    try {
      const limite = new Promise((_, rejeitar) => {
        tempo = setTimeout(() => rejeitar(new Error('A leitura demorou demais.')), 120000);
      });
      const w = await Promise.race([obterWorker(), limite]);
      await w.setParameters(modo);
      const { data } = await Promise.race([w.recognize(c, {}, { text: true, blocks: true }), limite]);
      return {
        texto: (data && data.text) || '',
        linhas: ((data && data.lines) || []).map(l => ({ texto: l.text, confianca: l.confidence })),
      };
    } catch (e) {
      await encerrarWorker();
      throw e;
    } finally {
      clearTimeout(tempo);
      aoProgredirAtual = null;
      // libera memória do celular se ficar parado
      timerEncerrar = setTimeout(encerrarWorker, 90000);
    }
  }

  // ---------- Interpretação do texto ----------
  const normalizar = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  function corrigirNumeros(linha) {
    let l = linha.replace(/\bR\s?[S5$]\s?(?=\d)/g, 'R$ ');
    l = l.replace(/[0-9OolI|]+\s?[.,]\s?[0-9OolI|]{2}\b/g, tok =>
      (/\d/.test(tok) ? tok.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1') : tok));
    return l;
  }

  function valoresNaLinha(linha) {
    const re = /(\d{1,3}(?:\.\d{3})+|\d{1,6})\s?[,.]\s?(\d{2})(?!\d)/g;
    const out = [];
    let m;
    while ((m = re.exec(linha))) {
      const antes = linha.slice(Math.max(0, m.index - 2), m.index);
      const depois = linha.slice(m.index + m[0].length, m.index + m[0].length + 3);
      if (/\d$|[\/:-]$|\d[.,]$/.test(antes)) continue;
      if (/^\s?%/.test(depois) || /^[.,\/]\d/.test(depois)) continue;
      const v = parseInt(m[1].replace(/\./g, ''), 10) * 100 + parseInt(m[2], 10);
      if (v > 0 && v < 10000000) out.push(v);
    }
    return out;
  }

  const REGRAS_TOTAL = [
    [/VALOR\s*A\s*PAGAR|TOTAL\s*A\s*PAGAR|TOTAL\s*PAGO|VALOR\s*COBRADO/, 100],
    [/VALOR\s*TOTAL|TOTAL\s*GERAL|TOTAL\s*R\s?\$|TOTAL\s*D[AO]\s*(CORRIDA|VIAGEM|COMPRA|CONTA|PEDIDO|NOTA|CUPOM)/, 90],
    [/\bTOTAL\b/, 80],
    // forma de pagamento: confirma o total, mas sozinha vale pouco (dinheiro entregue pode ter troco)
    [/VALOR\s*PAGO|CARTAO|CREDITO|DEBITO|\bPIX\b/, 50],
    [/DINHEIRO/, 15],
  ];
  // fora da conta: tributos, troco, desconto, subtotal, contagem de itens e o cabeçalho da tabela de itens
  const EXCLUIR = /SUB\s*-?\s*TOTAL|TRIBUT|IMPOSTO|LEI\s*N?.?\s*12|12\.?741|IBPT|APROX|TROCO|ITENS|\bQTD|QUANTIDADE|\bICMS|\bPIS\b|COFINS|DESCONTO|\bVL\.?\s*UNIT|DESCRICAO|\bCODIGO/;
  // linha de item da NFC-e: quantidade com 3-4 casas (1,0000) ou unidade seguida de preço (UN X 39,90)
  const ITEM = /\b\d+[.,]\d{3,4}\b|\b(UN|UND|UNID|KG|LT|PC|PCT|CX)\b\s*(X\s*)?\d/;

  // Cada valor ganha pontos conforme as linhas onde aparece (total, a pagar, cartão...). Aparecer em
  // várias linhas (ou nas duas leituras) reforça; bater com a soma dos itens também. O maior vence.
  function extrairValor(passes) {
    const pesos = new Map();
    const somas = new Set();
    const anotar = (v, p) => {
      if (!pesos.has(v)) pesos.set(v, []);
      pesos.get(v).push(p);
    };
    for (const { linhas, norm } of passes) {
      let soma = 0, itens = 0;
      norm.forEach((n, i) => {
        if (EXCLUIR.test(n)) return;
        const vals = valoresNaLinha(linhas[i]);
        if (ITEM.test(n) && vals.length) {
          soma += vals[vals.length - 1];
          itens++;
        }
        const regra = REGRAS_TOTAL.find(([re]) => re.test(n));
        if (!regra) {
          for (const v of vals) anotar(v, /R\$/.test(linhas[i]) ? 10 : 5);
          return;
        }
        if (vals.length) return anotar(vals[vals.length - 1], regra[1]);
        // valor na linha de baixo (layout em duas linhas)
        if (i + 1 < linhas.length && !EXCLUIR.test(norm[i + 1])) {
          const prox = valoresNaLinha(linhas[i + 1]);
          if (prox.length) anotar(prox[prox.length - 1], regra[1] - 15);
        }
      });
      if (itens) somas.add(soma);
      // total ilegível, mas itens legíveis: a soma deles vira candidata
      if (itens >= 2 && !pesos.has(soma)) anotar(soma, 30);
    }
    let melhor = null;
    for (const [v, ps] of pesos) {
      const max = Math.max.apply(null, ps);
      const resto = ps.reduce((a, b) => a + b, 0) - max;
      const pontos = max + 0.5 * resto + (somas.has(v) ? 40 : 0);
      if (!melhor || pontos > melhor.pontos || (pontos === melhor.pontos && v > melhor.valor)) {
        melhor = { valor: v, pontos, max, vezes: ps.length };
      }
    }
    if (!melhor) return { valor: null, confiante: false };
    return { valor: melhor.valor, confiante: melhor.max >= 80 && (melhor.vezes >= 2 || somas.has(melhor.valor)) };
  }

  const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const doisDig = n => String(n).padStart(2, '0');

  function extrairData(norm, hoje) {
    const limiteSup = new Date(hoje.getTime() + 2 * 86400000);
    const limiteInf = new Date(hoje.getTime() - 400 * 86400000);
    let melhor = null;
    const avaliar = (d, m, a, n, i) => {
      if (a < 100) a += 2000;
      if (m < 1 || m > 12 || d < 1 || d > 31) return;
      const dt = new Date(a, m - 1, d);
      if (dt.getMonth() !== m - 1 || dt > limiteSup || dt < limiteInf) return;
      let pontos = 0;
      if (/EMISS|DATA|\bDT\b/.test(n)) pontos += 2;
      if (/VENC|VALID|NASC|PREVIS/.test(n)) pontos -= 3;
      if (!melhor || pontos > melhor.pontos) melhor = { data: `${a}-${doisDig(m)}-${doisDig(d)}`, pontos, i };
    };
    norm.forEach((n, i) => {
      // OCR às vezes lê 0 como O dentro da data (ex.: 2O/09/2026)
      n = n.replace(/[0-9O]{1,2}\s?[\/.-]\s?[0-9O]{1,2}\s?[\/.-]\s?[0-9O]{2,4}/g, s => s.replace(/O/g, '0'));
      const reNum = /(\d{1,2})\s?[\/.-]\s?(\d{1,2})\s?[\/.-]\s?(\d{4}|\d{2})(?!\d)/g;
      let m;
      while ((m = reNum.exec(n))) avaliar(+m[1], +m[2], +m[3], n, i);
      const reNome = /(\d{1,2})\s*(?:DE\s+)?(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\.?\s*(?:DE\s+)?(\d{4})/g;
      while ((m = reNome.exec(n))) avaliar(+m[1], MESES.indexOf(m[2]) + 1, +m[3], n, i);
    });
    return melhor;
  }

  function extrairHora(norm, linhaData) {
    const re = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/;
    // na linha da data o OCR às vezes troca ":" por "." (09.26): aceita, depois de tirar a própria data
    if (linhaData != null) {
      const semData = norm[linhaData].replace(/\d{1,2}\s?[\/.-]\s?\d{1,2}\s?[\/.-]\s?\d{2,4}/g, ' ');
      const m = semData.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
      if (m) return `${doisDig(m[1])}:${m[2]}`;
    }
    for (const n of norm) {
      const m = n.match(re);
      if (m) return `${doisDig(m[1])}:${m[2]}`;
    }
    return null;
  }

  // Chave de acesso impressa na NFC-e (44 dígitos em grupos de 4): os dígitos 3 a 6 são ano e mês da emissão.
  function anoMesDaChave(linhas) {
    for (const l of linhas) {
      const m = l.match(/(?:\d{4}\s*){10}\d{4}/);
      if (!m) continue;
      const dig = m[0].replace(/\s/g, '');
      const ano = 2000 + parseInt(dig.slice(2, 4), 10), mes = parseInt(dig.slice(4, 6), 10);
      if (mes >= 1 && mes <= 12 && ano >= 2015) return { ano, mes };
    }
    return null;
  }

  // Se o mês/ano da data lida não bate com a chave de acesso (ex.: OCR leu 26/08 em vez de 26/09),
  // mantém o dia e corrige mês e ano pela chave.
  function conferirComChave(dataIso, chave, hoje) {
    if (!dataIso || !chave) return dataIso;
    const [a, m, d] = dataIso.split('-').map(Number);
    if (a === chave.ano && m === chave.mes) return dataIso;
    const corrigida = new Date(chave.ano, chave.mes - 1, d);
    if (corrigida.getMonth() !== chave.mes - 1 || corrigida > new Date(hoje.getTime() + 2 * 86400000)) return dataIso;
    return `${chave.ano}-${doisDig(chave.mes)}-${doisDig(d)}`;
  }

  const NAO_NOME = /CNPJ|CPF|\bI\.?E\b|INSC|DOCUMENTO|AUXILIAR|NFC|NOTA\s*FISCAL|CUPOM|ELETRONIC|CONSUMIDOR|DANFE|EXTRATO|\bSAT\b|ENDERECO|\bRUA\b|\bR\.\s|\bAV\b|AVENIDA|RODOVIA|ESTRADA|\bTEL|FONE|\bCEP\b|BAIRRO|CAIXA|OPERADOR|PROTOCOLO|CHAVE|EMISSAO|RECIBO|COMPROVANTE|\bVIA\b|CONSULTA|HTTP|WWW|SEFAZ|FAZENDA/;
  const SUFIXOS = /\s+(LTDA|ME|EPP|EIRELI|S\/?A|S\.A\.?|MEI)\.?$/;
  const PEQUENAS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);

  const compactar = l => corrigirNumeros(l.trim()).replace(/\s+/g, ' ');

  // confiavel(linha): se veio da leitura, só aceita linhas que o OCR leu com boa confiança
  function extrairEstabelecimento(linhas, norm, confiavel) {
    for (let i = 0; i < Math.min(8, linhas.length); i++) {
      if (confiavel && !confiavel(linhas[i])) continue;
      const t = linhas[i].replace(/\s+/g, ' ').trim();
      const n = norm[i];
      const semEspaco = t.replace(/\s/g, '');
      const letras = (n.match(/[A-Z]/g) || []).length;
      if (letras < 4 || letras / semEspaco.length < 0.7 || NAO_NOME.test(n)) continue;
      let nome = t.replace(/[^\p{L}\p{N}&.\-/' ]/gu, '').replace(/\s+/g, ' ').trim();
      for (let k = 0; k < 2; k++) nome = nome.replace(SUFIXOS, '');
      if (nome.length < 4) continue;
      // descarta ruído do OCR (carimbos, logos): palavras curtas demais não formam um nome
      const palavras = nome.split(' ');
      const media = palavras.reduce((s, p) => s + p.length, 0) / palavras.length;
      if (media < 3.5 || !palavras.some(p => p.length >= 4)) continue;
      return nome.split(' ').map((p, j) => {
        const up = p.toUpperCase();
        if (j > 0 && PEQUENAS.has(up)) return p.toLowerCase();
        return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
      }).join(' ').slice(0, 60);
    }
    return '';
  }

  // Palavras-chave por Subclassificação (lista da empresa)
  const PALAVRAS = {
    'Alimentação': /RESTAUR|QUEIJ|\bBROA|\bBOLO|\bPAO\b|\bPAES\b|\bOVOS?\b|\bLEITE|SALGAD|BISCOITO|QUITAND|\bKILO\b|\bQUILO\b|\bPASTEIS\b|PANQUECA|OMELETE|SOBREMESA|SALADA|\bSOPA\b|FEIJAO|\bARROZ|FRANGO|\bCARNE|PEIXE|LASANHA|MACARRAO|\bWRAP|\bSUCOS?\b|CAPUCCINO|CAPPUCCINO|ESPRESSO|LANCHONETE|LANCHE|PADARIA|PANIFIC|CONFEITARIA|PIZZ|CHURRASC|CAFETERIA|\bCAFE\b|\bBAR\b|BOTEQU|BOTECO|REFEIC|ALMOCO|JANTA|MARMIT|SELF.?SERVICE|BUFFET|\bPRATO|\bPF\b|SUCO|REFRIGERANTE|\bREFRI\b|AGUA MINERAL|CERVEJA|SALGADO|PASTEL|HAMBURG|BURGER|SANDUICHE|ACAI|SORVET|SUPERMERCADO|MERCADO|MERCEARIA|HORTIFRUTI|ACOUGUE|ALIMENTOS|IFOOD|MC ?DONALD|SUBWAY|ESFIHA|TAPIOCA|COXINHA|CHOPP|BEBIDA|COMIDA|CULINARIA|GASTRONOMIA|SUSHI|TEMAKI|GRILL|CANTINA|BISTRO|DOCERIA|COCA.?COLA|GUARANA|EMPADA|QUENTINHA/g,
    'Transporte': /UBER|\b99\s?(POP|TAXI|APP|COMFORT)|99APP|\bTAXI|CABIFY|INDRIVE|\bPOSTO\b|COMBUST|GASOLINA|ETANOL|DIESEL|\bGNV\b|ESTACIONA|ESTAPAR|PEDAGIO|SEM PARAR|CONECTCAR|RODOVIARIA|PASSAGE|ONIBUS|VIACAO|EXPRESSO|TRANSPORT|\bMETRO\b|\bBRT\b|BILHETE|AEROPORTO|EMBARQUE|LATAM|GOL LINHAS|AZUL LINHAS|LOCADORA|LOCALIZA|MOVIDA|UNIDAS|CORRIDA|VIAGEM|MOTORISTA|\bBARCA|LITRO|\bKM\b/g,
    'Hospedagem': /HOTEL|POUSADA|HOSTEL|HOSPEDA|\bDIARIA|AIRBNB|BOOKING|\bINN\b|\bFLAT\b|CHALE|CHECK.?IN|CHECK.?OUT|\bAPART/g,
    'EPI': /\bEPI\b|\bLUVA|\bBOTA\b|BOTINA|CAPACETE|PERNEIRA|OCULOS DE (PROTECAO|SEGURANCA)|PROTETOR (SOLAR|AURICULAR)|REPELENTE|MASCARA|UNIFORME|CAMISA UV|PROTECAO INDIVIDUAL/g,
    'Equipamentos': /FERRAGE|FERRAMENTA|ENXADA|CAVADEIRA|\bFACAO|\bFOICE|MOTOSSERRA|ROCADEIRA|PULVERIZADOR|\bTRENA|\bGPS\b|EQUIPAMENTO|MATERIA(L|IS) DE CONSTRUCAO|ELETRONICO|INFORMATICA|\bPILHA|BATERIA|LANTERNA|MANGUEIRA|CARRINHO DE MAO|ALICATE|MARTELO|SERROTE|LEROY|HOME CENTER/g,
    'Insumos': /ADUBO|FERTILIZ|CALCARIO|\bMUDAS?\b|SEMENTE|SUBSTRATO|AGROPEC|\bAGRO|AGRICOLA|DEFENSIVO|HERBICIDA|FORMICIDA|GLIFOSATO|HIDROGEL|INSUMO|\bNPK\b|UREIA|SUPERFOSFATO|ESTERCO|VIVEIRO|\bRACAO|LAVOURA|ARAME|MOURAO|ESTACA/g,
    'Plataformas': /SOFTWARE|ASSINATURA|LICENCA|PLATAFORMA|GOOGLE|MICROSOFT|ADOBE|APPLE\.COM|\bZOOM\b|DROPBOX|CANVA|OPENAI|ANTHROPIC|\bAWS\b|HOSPEDAGEM DE SITE|DOMINIO/g,
    'Prestação de serviço': /PRESTACAO DE SERVICO|MAO DE OBRA|DIARISTA|SERVICOS PRESTADOS|NOTA FISCAL DE SERVICO|NFS-?E|\bRPA\b|EMPREITADA/g,
    'República Reflora': /ALUGUEL|CONDOMINIO|ENERGIA ELETRICA|CONTA DE LUZ|SANEAMENTO|CEDAE|\bENEL\b|\bLIGHT\b|CEMIG/g,
  };

  function classificar(norm) {
    const cabeca = norm.slice(0, 6).join('\n');
    const tudo = norm.join('\n');
    let melhor = null;
    for (const [tipo, re] of Object.entries(PALAVRAS)) {
      const pontos = (tudo.match(re) || []).length + 2 * (cabeca.match(re) || []).length;
      if (pontos > 0 && (!melhor || pontos > melhor.pontos)) melhor = { tipo, pontos };
    }
    return melhor ? melhor.tipo : null;
  }

  // Refeição pela hora do recibo (ou a hora atual, se a nota não tiver hora legível)
  function refeicaoPorHora(hora) {
    const h = hora ? parseInt(hora, 10) + parseInt(hora.slice(3), 10) / 60 : new Date().getHours();
    if (h < 10.5) return 'Café da manhã';
    if (h < 15.5) return 'Almoço';
    if (h < 18.5) return 'Lanche';
    return 'Janta';
  }

  function sugerirDescricao(tipo, tudo, hora) {
    if (tipo === 'Alimentação') return refeicaoPorHora(hora);
    if (tipo === 'Transporte') {
      if (/UBER/.test(tudo)) return 'Deslocamento (Uber)';
      if (/\b99\s?(POP|TAXI|APP|COMFORT)|99APP/.test(tudo)) return 'Deslocamento (99)';
      if (/\bTAXI/.test(tudo)) return 'Deslocamento (Táxi)';
      if (/POSTO|COMBUST|GASOLINA|ETANOL|DIESEL|\bGNV\b/.test(tudo)) return 'Combustível';
      if (/ESTACIONA|ESTAPAR/.test(tudo)) return 'Estacionamento';
      if (/PEDAGIO|SEM PARAR|CONECTCAR/.test(tudo)) return 'Pedágio';
      if (/AEROPORTO|LATAM|GOL LINHAS|AZUL LINHAS/.test(tudo)) return 'Passagem aérea';
      if (/RODOVIARIA|PASSAGE|ONIBUS|VIACAO/.test(tudo)) return 'Passagem de ônibus';
      return 'Deslocamento';
    }
    if (tipo === 'Hospedagem') return 'Hospedagem';
    return tipo || '';
  }

  // Aceita o texto de uma leitura ou uma lista com o texto de cada leitura.
  function interpretarTexto(textos, hoje, confiavel) {
    hoje = hoje || new Date();
    const passes = (Array.isArray(textos) ? textos : [textos]).map(t => {
      const linhas = (t || '').split(/\r?\n/).map(l => corrigirNumeros(l.trim())).filter(l => l.length > 0);
      return { linhas, norm: linhas.map(normalizar) };
    });
    const base = passes.find(x => x.norm.length) || { linhas: [], norm: [] };
    const todas = passes.reduce((acc, x) => acc.concat(x.norm), []);
    const data = extrairData(todas, hoje);
    const hora = extrairHora(todas, data ? data.i : null);
    const tipo = classificar(base.norm);
    const valor = extrairValor(passes);
    return {
      valor: valor.valor,
      confiante: valor.confiante,
      data: conferirComChave(data ? data.data : null, anoMesDaChave(passes.reduce((acc, x) => acc.concat(x.linhas), [])), hoje),
      hora,
      tipo,
      estabelecimento: extrairEstabelecimento(base.linhas, base.norm, confiavel),
      descricao: sugerirDescricao(tipo, base.norm.join('\n'), hora),
    };
  }

  // Junta QR (mais confiável) com o OCR.
  function combinar(qr, ocr) {
    const r = Object.assign({}, ocr);
    if (qr.valor) r.valor = qr.valor;
    if (qr.data) r.data = qr.data;
    else if (qr.ano && qr.mes) {
      const okOCR = r.data && +r.data.slice(0, 4) === qr.ano && +r.data.slice(5, 7) === qr.mes;
      if (!okOCR && qr.dia) r.data = `${qr.ano}-${doisDig(qr.mes)}-${doisDig(qr.dia)}`;
    }
    if (qr.hora) r.hora = qr.hora;
    r.link = qr.link || '';
    return r;
  }

  async function analisar(img, aoProgredir) {
    let qr = {};
    try {
      const textoQR = await lerQR(img);
      if (textoQR) qr = interpretarQR(textoQR);
    } catch (e) { console.warn('QR', e); }
    const textos = [];
    const boas = new Set(); // linhas lidas com confiança >= 70
    let falhou = false;
    let c = null;
    try {
      c = prepararParaOCR(img);
      for (let k = 0; k < MODOS.length; k++) {
        const lido = await reconhecer(c, MODOS[k], m => {
          if (aoProgredir) aoProgredir(Object.assign({}, m, { passo: k + 1 }));
        });
        textos.push(lido.texto);
        for (const l of lido.linhas) if (l.confianca >= 70) boas.add(compactar(l.texto));
        // para na 1ª leitura se ela já tem certeza do total (ou se o QR code já trouxe o valor)
        if (qr.valor || interpretarTexto(textos).confiante) break;
      }
    } catch (e) {
      console.warn('OCR', e);
      falhou = !textos.length;
    } finally {
      if (c) c.width = c.height = 0;
    }
    const r = combinar(qr, interpretarTexto(textos, null, l => boas.has(compactar(l))));
    r.falhouOCR = falhou;
    r.textoLido = textos.join('\n-----\n');
    r.leituras = textos.length;
    return r;
  }

  return { carregarImagem, desenhar, canvasParaBlob, analisar, interpretarTexto, interpretarQR, combinar, carregarScript, refeicaoPorHora };
})();
