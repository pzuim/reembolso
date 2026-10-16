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
  function carregarImagem(arquivo) {
    return new Promise((resolver, rejeitar) => {
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => resolver({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); rejeitar(new Error('Não foi possível abrir esta imagem. Tente tirar a foto novamente.')); };
      img.src = url;
    });
  }

  function desenhar(img, maxLado, recorte) {
    const r = recorte || { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
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

  // Tons de cinza + contraste esticado: ajuda o OCR com cupons térmicos apagados.
  function prepararParaOCR(img) {
    const c = desenhar(img, 2200);
    const ctx = c.getContext('2d');
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
      if (Math.max(img.naturalWidth, img.naturalHeight) <= maxLado) break;
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
        await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
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

  async function reconhecer(img, aoProgredir) {
    clearTimeout(timerEncerrar);
    const c = prepararParaOCR(img);
    aoProgredirAtual = aoProgredir;
    let tempo;
    try {
      const limite = new Promise((_, rejeitar) => {
        tempo = setTimeout(() => rejeitar(new Error('A leitura demorou demais.')), 120000);
      });
      const w = await Promise.race([obterWorker(), limite]);
      const { data } = await Promise.race([w.recognize(c), limite]);
      return (data && data.text) || '';
    } catch (e) {
      await encerrarWorker();
      throw e;
    } finally {
      clearTimeout(tempo);
      aoProgredirAtual = null;
      c.width = c.height = 0;
      // libera memória do celular se ficar parado
      timerEncerrar = setTimeout(encerrarWorker, 90000);
    }
  }

  // ---------- Interpretação do texto ----------
  const normalizar = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

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
    [/VALOR\s*A\s*PAGAR|TOTAL\s*A\s*PAGAR|VALOR\s*PAGO|TOTAL\s*PAGO|VALOR\s*COBRADO/, 100],
    [/VALOR\s*TOTAL|TOTAL\s*GERAL|TOTAL\s*R\s?\$|TOTAL\s*D[AO]\s*(CORRIDA|VIAGEM|COMPRA|CONTA|PEDIDO|NOTA|CUPOM)/, 90],
    [/\bTOTAL\b/, 80],
    [/CARTAO|CREDITO|DEBITO|\bPIX\b/, 50],
    [/DINHEIRO/, 40],
  ];
  const EXCLUIR = /SUB\s*-?\s*TOTAL|TRIBUT|IMPOSTO|LEI\s*N?.?\s*12|12\.?741|IBPT|APROX|TROCO|ITENS|\bQTD|QUANTIDADE|\bICMS|\bPIS\b|COFINS|DESCONTO/;

  function extrairValor(linhas, norm) {
    let melhor = null;
    const considerar = (valor, pontos) => {
      if (!melhor || pontos > melhor.pontos || (pontos === melhor.pontos && valor > melhor.valor)) melhor = { valor, pontos };
    };
    norm.forEach((n, i) => {
      if (EXCLUIR.test(n)) return;
      const regra = REGRAS_TOTAL.find(([re]) => re.test(n));
      if (!regra) return;
      const vals = valoresNaLinha(linhas[i]);
      if (vals.length) return considerar(vals[vals.length - 1], regra[1]);
      // valor na linha de baixo (layout em duas linhas)
      if (i + 1 < linhas.length && !EXCLUIR.test(norm[i + 1])) {
        const prox = valoresNaLinha(linhas[i + 1]);
        if (prox.length) considerar(prox[prox.length - 1], regra[1] - 15);
      }
    });
    if (!melhor) {
      norm.forEach((n, i) => {
        if (EXCLUIR.test(n)) return;
        const pontos = /R\$/.test(linhas[i]) ? 30 : 10;
        for (const v of valoresNaLinha(linhas[i])) considerar(v, pontos);
      });
    }
    return melhor ? melhor.valor : null;
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
    const ordem = linhaData != null ? [linhaData].concat(norm.map((_, i) => i).filter(i => i !== linhaData)) : norm.map((_, i) => i);
    for (const i of ordem) {
      const m = norm[i].match(re);
      if (m) return `${doisDig(m[1])}:${m[2]}`;
    }
    return null;
  }

  const NAO_NOME = /CNPJ|CPF|\bI\.?E\b|INSC|DOCUMENTO|AUXILIAR|NFC|NOTA\s*FISCAL|CUPOM|ELETRONIC|CONSUMIDOR|DANFE|EXTRATO|\bSAT\b|ENDERECO|\bRUA\b|\bR\.\s|\bAV\b|AVENIDA|RODOVIA|ESTRADA|\bTEL|FONE|\bCEP\b|BAIRRO|CAIXA|OPERADOR|PROTOCOLO|CHAVE|EMISSAO|RECIBO|COMPROVANTE|\bVIA\b|CONSULTA|HTTP|WWW|SEFAZ|FAZENDA/;
  const SUFIXOS = /\s+(LTDA|ME|EPP|EIRELI|S\/?A|S\.A\.?|MEI)\.?$/;
  const PEQUENAS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);

  function extrairEstabelecimento(linhas, norm) {
    for (let i = 0; i < Math.min(8, linhas.length); i++) {
      const t = linhas[i].replace(/\s+/g, ' ').trim();
      const n = norm[i];
      const semEspaco = t.replace(/\s/g, '');
      const letras = (n.match(/[A-Z]/g) || []).length;
      if (letras < 4 || letras / semEspaco.length < 0.7 || NAO_NOME.test(n)) continue;
      let nome = t.replace(/[^\p{L}\p{N}&.\-/' ]/gu, '').replace(/\s+/g, ' ').trim();
      for (let k = 0; k < 2; k++) nome = nome.replace(SUFIXOS, '');
      if (nome.length < 4) continue;
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
    'Alimentação': /RESTAUR|LANCHONETE|LANCHE|PADARIA|PANIFIC|CONFEITARIA|PIZZ|CHURRASC|CAFETERIA|\bCAFE\b|\bBAR\b|BOTEQU|BOTECO|REFEIC|ALMOCO|JANTA|MARMIT|SELF.?SERVICE|BUFFET|\bPRATO|\bPF\b|SUCO|REFRIGERANTE|\bREFRI\b|AGUA MINERAL|CERVEJA|SALGADO|PASTEL|HAMBURG|BURGER|SANDUICHE|ACAI|SORVET|SUPERMERCADO|MERCADO|MERCEARIA|HORTIFRUTI|ACOUGUE|ALIMENTOS|IFOOD|MC ?DONALD|SUBWAY|ESFIHA|TAPIOCA|COXINHA|CHOPP|BEBIDA|COMIDA|CULINARIA|GASTRONOMIA|SUSHI|TEMAKI|GRILL|CANTINA|BISTRO|DOCERIA|COCA.?COLA|GUARANA|EMPADA|QUENTINHA/g,
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

  function sugerirDescricao(tipo, tudo, hora) {
    if (tipo === 'Alimentação') {
      const h = hora ? parseInt(hora, 10) + parseInt(hora.slice(3), 10) / 60 : new Date().getHours();
      if (h < 10.5) return 'Café da manhã';
      if (h < 15.5) return 'Almoço';
      if (h < 18.5) return 'Lanche';
      return 'Janta';
    }
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

  function interpretarTexto(texto, hoje) {
    hoje = hoje || new Date();
    const linhas = (texto || '').split(/\r?\n/).map(l => corrigirNumeros(l.trim())).filter(l => l.length > 0);
    const norm = linhas.map(normalizar);
    const data = extrairData(norm, hoje);
    const hora = extrairHora(norm, data ? data.i : null);
    const tipo = classificar(norm);
    return {
      valor: extrairValor(linhas, norm),
      data: data ? data.data : null,
      hora,
      tipo,
      estabelecimento: extrairEstabelecimento(linhas, norm),
      descricao: sugerirDescricao(tipo, norm.join('\n'), hora),
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
    let texto = '';
    let falhou = false;
    try {
      texto = await reconhecer(img, aoProgredir);
    } catch (e) {
      console.warn('OCR', e);
      falhou = true;
    }
    const r = combinar(qr, interpretarTexto(texto));
    r.falhouOCR = falhou;
    r.textoLido = texto;
    return r;
  }

  return { carregarImagem, desenhar, canvasParaBlob, analisar, interpretarTexto, interpretarQR, combinar, carregarScript };
})();
