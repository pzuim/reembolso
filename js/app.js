/* App Reembolso: telas, formulário e fluxo principal. */
(() => {
  const VERSAO = '1.2.0';
  const LISTA1 = ['PDD', 'Plantio (PAI1)', 'Plantio (PAI2)', 'Administrativo', 'Legal'];
  const LISTA2 = ['Alimentação', 'Transporte', 'Hospedagem', 'Insumos', 'Equipamentos', 'EPI', 'Prestação de serviço', 'Plataformas', 'República Reflora', 'Salário', 'VERRA'];
  const LISTA3 = ['Implantação', 'Acompanhamento e manutenção'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DESCRICOES_COMUNS = ['Café da manhã', 'Almoço', 'Lanche', 'Janta', 'Deslocamento (Uber)', 'Deslocamento (99)', 'Combustível', 'Estacionamento', 'Pedágio', 'Passagem de ônibus', 'Hospedagem'];
  const TELAS = ['cadastro', 'pin', 'lista', 'gasto', 'exportar', 'ajustes'];

  const $ = id => document.getElementById(id);
  const estado = {
    perfil: null,
    padroes: { classificacao: '', fase: '' },
    ano: 0,
    mes: 0,
    gastos: [],
    tela: '',
    form: null,
    arquivos: null,
    destinoFoto: 'novo',
    fila: [], // fotos da galeria esperando para virar gasto
    filaTotal: 0,
    atualizando: false,
    sw: null,
  };

  // ---------- utilidades ----------
  const pad = n => String(n).padStart(2, '0');
  const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dataBR = iso => iso.split('-').reverse().join('/');
  const moeda = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarValor = c => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nomeMes = (a, m) => `${MESES[m - 1].charAt(0).toUpperCase()}${MESES[m - 1].slice(1)} de ${a}`;
  const chaveMes = (a, m) => `${a}-${pad(m)}`;
  const nomeChave = k => nomeMes(+k.slice(0, 4), +k.slice(5, 7));
  const mesDoGasto = g => g.mes || g.data.slice(0, 7);

  // A planilha do mês M vai até o dia 20 do mês seguinte: este é o mês mais antigo ainda "aberto".
  function mesMaisAntigoAberto() {
    const h = new Date();
    let a = h.getFullYear(), m = h.getMonth() + 1;
    if (h.getDate() <= 20) { m--; if (m < 1) { m = 12; a--; } }
    return chaveMes(a, m);
  }

  // Em qual planilha lançar: a do mês do recibo; se o prazo dela já passou (recibo atrasado),
  // a do mês que está aberto na tela (ou o mês mais antigo ainda no prazo).
  function mesPadrao(data) {
    const doRecibo = data.slice(0, 7);
    const aberto = mesMaisAntigoAberto();
    if (doRecibo >= aberto) return doRecibo;
    const naTela = chaveMes(estado.ano, estado.mes);
    return naTela >= aberto ? naTela : aberto;
  }
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const el = (tag, cls, texto) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  };

  function lerValor(s) {
    s = String(s || '').replace(/[R$\s]/g, '');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }

  function hashPIN(pin, sal) {
    const str = sal + ':' + pin;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
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

  let timerToast;
  function toast(texto) {
    const t = $('toast');
    t.textContent = texto;
    t.classList.add('visivel');
    clearTimeout(timerToast);
    timerToast = setTimeout(() => t.classList.remove('visivel'), 2800);
  }

  function ocupado(texto) { $('carregando-texto').textContent = texto || 'Aguarde…'; $('carregando').hidden = false; }
  function livre() { $('carregando').hidden = true; }

  function confirmar(texto, opcoes) {
    const o = Object.assign({ sim: 'OK', nao: 'Cancelar', soOk: false }, opcoes);
    return new Promise(resolver => {
      $('modal-texto').textContent = texto;
      $('modal-sim').textContent = o.sim;
      $('modal-nao').textContent = o.nao;
      $('modal-nao').hidden = o.soOk;
      const campo = $('modal-campo');
      campo.hidden = !o.campo;
      campo.value = '';
      campo.placeholder = o.campo || '';
      $('modal').hidden = false;
      if (o.campo) setTimeout(() => campo.focus(), 50);
      const fim = v => {
        $('modal').hidden = true;
        $('modal-sim').onclick = $('modal-nao').onclick = null;
        resolver(v);
      };
      $('modal-sim').onclick = () => fim(o.campo ? campo.value : true);
      $('modal-nao').onclick = () => fim(o.campo ? null : false);
    });
  }
  const avisar = texto => confirmar(texto, { soOk: true });

  // ---------- navegação ----------
  function mostrar(nome) {
    for (const t of TELAS) $('tela-' + t).hidden = t !== nome;
    estado.tela = nome;
    window.scrollTo(0, 0);
  }
  function abrirSubtela(nome) {
    history.pushState({ tela: nome }, '');
    mostrar(nome);
  }

  window.addEventListener('popstate', async () => {
    if (!$('visor').hidden) { fecharVisor(); return; }
    if (estado.tela === 'gasto' && estado.form && estado.form.alterado) {
      history.pushState({ tela: 'gasto' }, '');
      const resto = estado.filaTotal ? estado.fila.length : 0;
      const msg = resto
        ? `Sair sem salvar este gasto?\nAs outras ${resto} fotos escolhidas também não serão lançadas.`
        : 'Sair sem salvar este gasto?';
      if (await confirmar(msg, { sim: 'Sair sem salvar', nao: 'Continuar editando' })) {
        limparFila();
        fecharForm();
        history.back();
      }
      return;
    }
    if (['gasto', 'exportar', 'ajustes'].includes(estado.tela)) {
      if (estado.tela === 'gasto') { fecharForm(); limparFila(); }
      mostrar('lista');
      renderLista();
    }
  });

  // ---------- início ----------
  async function iniciar() {
    registrarSW();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* opcional */ }
    preencherSelects();
    ligarEventos();
    $('versao').textContent = 'Versão ' + VERSAO + ' · os dados ficam somente neste celular';
    const hoje = new Date();
    estado.ano = hoje.getFullYear();
    estado.mes = hoje.getMonth() + 1;
    try {
      estado.perfil = await DB.lerConfig('perfil');
      estado.padroes = Object.assign({ classificacao: '', fase: '' }, await DB.lerConfig('padroes'));
    } catch (e) {
      await avisar('Não foi possível abrir o armazenamento do celular. Se estiver em aba anônima, abra o app normalmente.\n\n' + e.message);
      return;
    }
    if (!estado.perfil) {
      mostrar('cadastro');
    } else if (estado.perfil.pinHash && !estado.perfil.semPin) {
      $('pin-ola').textContent = 'Olá, ' + estado.perfil.nome.split(' ')[0] + '!';
      mostrar('pin');
      setTimeout(() => $('pin-entrada').focus(), 100);
    } else {
      entrar();
    }
  }

  async function entrar() {
    estado.gastos = await DB.todos('gastos');
    history.replaceState({ tela: 'lista' }, '');
    mostrar('lista');
    renderLista();
  }

  function preencherSelects() {
    const preencher = (sel, lista) => {
      sel.textContent = '';
      sel.appendChild(new Option('—', ''));
      for (const item of lista) sel.appendChild(new Option(item, item));
    };
    for (const f of [$('form-gasto'), $('form-ajustes')]) {
      preencher(f.elements.classificacao, LISTA1);
      preencher(f.elements.fase, LISTA3);
    }
    const chips = $('chips-tipo');
    for (const tipo of LISTA2) {
      const b = el('button', 'chip', tipo);
      b.type = 'button';
      b.dataset.tipo = tipo;
      b.setAttribute('aria-pressed', 'false');
      chips.appendChild(b);
    }
  }

  // ---------- cadastro / PIN ----------
  async function salvarCadastro(e) {
    e.preventDefault();
    const f = e.target;
    const nome = f.nome.value.trim();
    const pix = f.pix.value.trim();
    const pin = f.pin.value.trim();
    if (!nome || !pix) return avisar('Preencha seu nome e os dados bancários/PIX.');
    if (pin && !/^\d{4,6}$/.test(pin)) return avisar('O PIN deve ter de 4 a 6 números.');
    const sal = novoId();
    estado.perfil = { nome, pix, pinSal: sal, pinHash: pin ? hashPIN(pin, sal) : '', semPin: !pin };
    await DB.gravarConfig('perfil', estado.perfil);
    f.reset();
    entrar();
  }

  function conferirPIN(e) {
    e.preventDefault();
    const entrada = $('pin-entrada');
    if (hashPIN(entrada.value.trim(), estado.perfil.pinSal) === estado.perfil.pinHash) {
      entrada.value = '';
      $('pin-erro').hidden = true;
      entrar();
    } else {
      entrada.value = '';
      $('pin-erro').hidden = false;
      if (navigator.vibrate) navigator.vibrate(150);
      entrada.focus();
    }
  }

  async function esqueciPIN() {
    const resp = await confirmar('Para entrar sem o PIN, digite a chave PIX/dados bancários que você cadastrou.', { sim: 'Confirmar', campo: 'Dados bancários / PIX' });
    if (resp == null) return;
    const limpo = s => String(s).replace(/[\s.\-\/()]/g, '').toLowerCase();
    if (limpo(resp) && limpo(resp) === limpo(estado.perfil.pix)) {
      estado.perfil.pinHash = '';
      estado.perfil.semPin = true;
      await DB.gravarConfig('perfil', estado.perfil);
      await entrar();
      toast('PIN removido. Crie um novo em Ajustes.');
    } else {
      avisar('Os dados não conferem.');
    }
  }

  // ---------- lista do mês ----------
  const doMes = (a, m) => estado.gastos.filter(g => g.data && mesDoGasto(g) === chaveMes(a, m));
  const ordenar = (lista, desc) => lista.slice().sort((x, y) =>
    (x.data === y.data ? (x.criadoEm || '').localeCompare(y.criadoEm || '') : x.data.localeCompare(y.data)) * (desc ? -1 : 1));

  function renderLista() {
    const gastos = ordenar(doMes(estado.ano, estado.mes), true);
    const total = gastos.reduce((s, g) => s + g.valor, 0);
    $('mes-nome').textContent = nomeMes(estado.ano, estado.mes);
    const resumo = $('mes-resumo');
    resumo.textContent = `${gastos.length} ${gastos.length === 1 ? 'recibo' : 'recibos'} · Total `;
    resumo.appendChild(el('strong', '', moeda(total)));

    const ul = $('lista');
    ul.textContent = '';
    for (const g of gastos) {
      const li = el('li', 'item');
      li.tabIndex = 0;
      if (g.thumb) {
        const img = el('img', 'item-thumb');
        img.src = g.thumb;
        img.alt = '';
        li.appendChild(img);
      } else {
        li.appendChild(el('div', 'item-thumb', 'sem foto'));
      }
      const meio = el('div', 'item-meio');
      meio.appendChild(el('div', 'item-desc', g.descricao || g.subclassificacao || 'Despesa'));
      const dataTxt = g.data.slice(0, 7) === chaveMes(estado.ano, estado.mes) ? dataBR(g.data).slice(0, 5) : dataBR(g.data);
      const info = el('div', 'item-info', `${dataTxt} · ${g.subclassificacao || ''}`);
      if (!g.subclassificacao) info.appendChild(el('span', 'tag-aviso', 'sem tipo'));
      meio.appendChild(info);
      li.appendChild(meio);
      li.appendChild(el('div', 'item-valor', moeda(g.valor)));
      li.addEventListener('click', () => abrirFormEdicao(g.id));
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter') abrirFormEdicao(g.id); });
      ul.appendChild(li);
    }
    $('lista-vazia').hidden = gastos.length > 0;
  }

  function mudarMes(delta) {
    let m = estado.mes + delta, a = estado.ano;
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    estado.mes = m;
    estado.ano = a;
    renderLista();
  }

  // ---------- formulário do gasto ----------
  const campos = () => $('form-gasto').elements;

  function prepararForm(gasto, fotos) {
    fecharForm();
    estado.form = {
      id: gasto ? gasto.id : null,
      original: gasto,
      fotos,
      removidas: [],
      tocados: new Set(),
      alterado: false,
      tipo: gasto ? gasto.subclassificacao || '' : '',
    };
    const c = campos();
    c.valor.value = gasto ? formatarValor(gasto.valor) : '';
    c.data.value = gasto ? gasto.data : isoLocal(new Date());
    c.descricao.value = gasto ? gasto.descricao || '' : '';
    c.observacao.value = gasto ? gasto.observacao || '' : '';
    c.link.value = gasto ? gasto.link || '' : '';
    c.classificacao.value = gasto ? gasto.classificacao || '' : estado.padroes.classificacao || '';
    c.fase.value = gasto ? gasto.fase || '' : estado.padroes.fase || '';
    preencherMeses(gasto ? mesDoGasto(gasto) : mesPadrao(c.data.value));
    for (const x of $('form-gasto').querySelectorAll('.campo-auto')) x.classList.remove('campo-auto');
    const naFila = !gasto && estado.filaTotal > 0;
    $('gasto-titulo').textContent = gasto ? 'Editar gasto'
      : naFila ? `Recibo ${estado.filaTotal - estado.fila.length} de ${estado.filaTotal}` : 'Novo gasto';
    $('btn-pular').hidden = !naFila;
    $('btn-excluir').hidden = !gasto;
    $('gasto-erro').hidden = true;
    esconderLeitura();
    renderChips();
    renderFotos();
    atualizarSugestoes();
  }

  function preencherMeses(selecionado) {
    const sel = campos().mes;
    sel.textContent = '';
    const h = new Date();
    const chaves = [];
    for (let k = 1; k >= -13; k--) {
      const d = new Date(h.getFullYear(), h.getMonth() + k, 1);
      chaves.push(chaveMes(d.getFullYear(), d.getMonth() + 1));
    }
    if (selecionado && !chaves.includes(selecionado)) chaves.push(selecionado);
    chaves.sort().reverse();
    for (const k of chaves) sel.appendChild(new Option(nomeChave(k), k));
    sel.value = selecionado;
    atualizarAvisoMes();
  }

  // Quando a data muda (leitura automática ou digitada), o mês da planilha acompanha, se não foi escolhido à mão
  function atualizarMesAuto() {
    const form = estado.form;
    const c = campos();
    if (!form || form.tocados.has('mes') || !/^\d{4}-\d{2}-\d{2}$/.test(c.data.value)) return atualizarAvisoMes();
    preencherMeses(mesPadrao(c.data.value));
  }

  function atualizarAvisoMes() {
    const c = campos();
    const aviso = $('mes-aviso');
    const doRecibo = (c.data.value || '').slice(0, 7);
    if (doRecibo.length === 7 && c.mes.value && doRecibo !== c.mes.value) {
      aviso.textContent = `Recibo de ${nomeChave(doRecibo).toLowerCase()}, lançado na planilha de ${nomeChave(c.mes.value).toLowerCase()}.`;
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }
  }

  function fecharForm() {
    const f = estado.form;
    if (!f) return;
    for (const foto of f.fotos) if (foto.url) URL.revokeObjectURL(foto.url);
    estado.form = null;
  }

  function abrirFormNovo(arquivo, semHistorico) {
    prepararForm(null, []);
    if (semHistorico) window.scrollTo(0, 0);
    else abrirSubtela('gasto');
    if (arquivo) {
      if (arquivo.lastModified) {
        const d = new Date(arquivo.lastModified);
        if (d <= new Date()) {
          campos().data.value = isoLocal(d);
          atualizarMesAuto();
        }
      }
      adicionarFoto(arquivo);
    }
  }

  // Várias fotos escolhidas na galeria: abre uma de cada vez para conferir e salvar
  function proximoDaFila() {
    if (!estado.fila.length) {
      estado.filaTotal = 0;
      return false;
    }
    abrirFormNovo(estado.fila.shift(), true);
    return true;
  }

  function limparFila() {
    estado.fila = [];
    estado.filaTotal = 0;
  }

  function pularFoto() {
    fecharForm();
    if (!proximoDaFila()) history.back();
  }

  async function abrirFormEdicao(id) {
    const gasto = estado.gastos.find(g => g.id === id);
    if (!gasto) return;
    const fotos = [];
    for (const fid of gasto.fotos || []) {
      const f = await DB.obter('fotos', fid);
      if (f) fotos.push({ id: f.id, novo: false, w: f.w, h: f.h, tipo: f.tipo, thumb: f.thumb || gasto.thumb, url: URL.createObjectURL(new Blob([f.dados], { type: f.tipo || 'image/jpeg' })) });
    }
    prepararForm(gasto, fotos);
    abrirSubtela('gasto');
  }

  function renderChips() {
    for (const b of $('chips-tipo').children) b.setAttribute('aria-pressed', String(b.dataset.tipo === estado.form.tipo));
  }

  function renderFotos() {
    const box = $('fotos');
    box.textContent = '';
    const form = estado.form;
    form.fotos.forEach((foto, i) => {
      const d = el('div', 'foto');
      const img = el('img');
      img.src = foto.thumb || foto.url;
      img.alt = `Foto ${i + 1} do recibo`;
      img.addEventListener('click', () => abrirVisor(foto.url));
      d.appendChild(img);
      const rem = el('button', 'btn foto-remover', '✕');
      rem.type = 'button';
      rem.setAttribute('aria-label', 'Remover foto');
      rem.addEventListener('click', async () => {
        if (!(await confirmar('Remover esta foto?', { sim: 'Remover' }))) return;
        form.fotos.splice(form.fotos.indexOf(foto), 1);
        if (!foto.novo) form.removidas.push(foto.id);
        if (foto.url) URL.revokeObjectURL(foto.url);
        form.alterado = true;
        renderFotos();
      });
      d.appendChild(rem);
      box.appendChild(d);
    });
    const addCam = el('button', 'btn foto-add');
    addCam.type = 'button';
    addCam.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
    addCam.appendChild(document.createTextNode(form.fotos.length ? 'Mais uma foto' : 'Tirar foto'));
    addCam.addEventListener('click', () => escolherFoto('form', 'in-camera'));
    box.appendChild(addCam);
    const addGal = el('button', 'btn foto-add');
    addGal.type = 'button';
    addGal.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';
    addGal.appendChild(document.createTextNode('Da galeria'));
    addGal.addEventListener('click', () => escolherFoto('form', 'in-galeria'));
    box.appendChild(addGal);
  }

  function atualizarSugestoes() {
    const dl = $('sugestoes-descricao');
    dl.textContent = '';
    const vistos = new Set();
    const recentes = estado.gastos.slice().sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
    for (const d of recentes.map(g => g.descricao).concat(DESCRICOES_COMUNS)) {
      if (!d || vistos.has(d.toLowerCase())) continue;
      vistos.add(d.toLowerCase());
      dl.appendChild(new Option(d));
      if (vistos.size >= 40) break;
    }
  }

  function escolherFoto(destino, inputId) {
    estado.destinoFoto = destino;
    const inp = $(inputId);
    inp.value = '';
    inp.click();
  }

  async function aoEscolherArquivo(e) {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = '';
    if (!arquivos.length) return;
    if (estado.destinoFoto === 'form' && estado.form) {
      // fotos extras do mesmo recibo (ex.: cupom comprido)
      for (const a of arquivos) await adicionarFoto(a);
      return;
    }
    estado.fila = arquivos.slice(1);
    estado.filaTotal = arquivos.length > 1 ? arquivos.length : 0;
    abrirFormNovo(arquivos[0]);
  }

  function mostrarLeitura(texto, tipo) {
    const box = $('leitura');
    box.hidden = false;
    box.className = 'leitura' + (tipo ? ' ' + tipo : '');
    $('leitura-texto').textContent = texto;
  }
  function esconderLeitura() { $('leitura').hidden = true; }

  async function adicionarFoto(arquivo) {
    const form = estado.form;
    mostrarLeitura('Preparando a foto…');
    let carregada;
    try {
      carregada = await Leitura.carregarImagem(arquivo, msg => { if (estado.form === form) mostrarLeitura(msg); });
    } catch (e) {
      if (estado.form === form) mostrarLeitura(e.message, 'falha');
      return;
    }
    const { img, url } = carregada;
    try {
      const c = Leitura.desenhar(img, 2000);
      const blob = await Leitura.canvasParaBlob(c, 0.82);
      const w = c.width, h = c.height;
      c.width = c.height = 0;
      const t = Leitura.desenhar(img, 240);
      const thumb = t.toDataURL('image/jpeg', 0.7);
      const dados = await blobParaBuffer(blob);
      if (estado.form !== form) return;
      form.fotos.push({ id: novoId(), novo: true, dados, w, h, tipo: 'image/jpeg', thumb, url: URL.createObjectURL(blob) });
      form.alterado = true;
      renderFotos();
      // lê o recibo na primeira foto de um gasto novo, ou se o valor ainda estiver vazio
      if ((form.fotos.length === 1 && !form.original) || !campos().valor.value) {
        await lerRecibo(img, form);
      } else {
        esconderLeitura();
      }
    } catch (e) {
      if (estado.form === form) mostrarLeitura('Erro ao processar a foto: ' + e.message, 'falha');
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (img.close) img.close();
    }
  }

  async function lerRecibo(img, form) {
    mostrarLeitura('Procurando QR code e valores no recibo…');
    const r = await Leitura.analisar(img, m => {
      if (estado.form !== form) return;
      const pct = Math.round((m.progress || 0) * 100);
      if (m.status === 'recognizing text') mostrarLeitura(m.passo > 1 ? `Conferindo o valor (2ª leitura)… ${pct}%` : `Lendo o recibo… ${pct}%`);
      else if (/load|initializ/.test(m.status || '')) mostrarLeitura('Preparando a leitura (pode demorar na primeira vez)…');
    });
    if (estado.form !== form) return;
    aplicarLeitura(r);
  }

  function preencherAuto(nome, valor) {
    const form = estado.form;
    if (!valor || form.tocados.has(nome)) return false;
    const campo = campos()[nome];
    campo.value = valor;
    campo.classList.add('campo-auto');
    return true;
  }

  function aplicarLeitura(r) {
    const form = estado.form;
    const achouValor = preencherAuto('valor', r.valor ? formatarValor(r.valor) : '');
    preencherAuto('data', r.data);
    atualizarMesAuto();
    if (r.tipo && !form.tocados.has('tipo')) {
      form.tipo = r.tipo;
      renderChips();
    }
    preencherAuto('descricao', r.descricao);
    preencherAuto('observacao', r.estabelecimento);
    preencherAuto('link', r.link);
    if (r.falhouOCR && !r.valor) {
      mostrarLeitura('Não consegui ler o recibo automaticamente. Preencha os campos abaixo.', 'falha');
    } else if (!r.valor && !form.tocados.has('valor')) {
      mostrarLeitura('Não encontrei o valor na foto. Confira e preencha os campos.', 'falha');
    } else {
      mostrarLeitura(achouValor || r.data || r.tipo
        ? 'Pronto! Confira os campos marcados em verde antes de salvar.'
        : 'Leitura concluída. Confira os campos antes de salvar.', 'ok');
    }
  }

  function erroForm(msg) {
    const p = $('gasto-erro');
    p.textContent = msg;
    p.hidden = false;
    p.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function salvarGasto(e) {
    e.preventDefault();
    const form = estado.form;
    if (!form) return;
    const c = campos();
    const valor = lerValor(c.valor.value);
    if (!valor) return erroForm('Informe o valor do gasto (ex.: 33,90).');
    const data = c.data.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return erroForm('Informe a data do gasto.');
    $('gasto-erro').hidden = true;
    const agora = new Date().toISOString();
    const gasto = {
      id: form.id || novoId(),
      data,
      valor,
      descricao: c.descricao.value.trim() || form.tipo || 'Despesa',
      observacao: c.observacao.value.trim(),
      classificacao: c.classificacao.value,
      subclassificacao: form.tipo,
      fase: c.fase.value,
      mes: c.mes.value || data.slice(0, 7),
      link: c.link.value.trim(),
      fotos: form.fotos.map(f => f.id),
      thumb: form.fotos.length ? form.fotos[0].thumb : '',
      criadoEm: form.original ? form.original.criadoEm : agora,
      atualizadoEm: agora,
    };
    const dup = estado.gastos.find(g => g.id !== gasto.id && g.data === gasto.data && g.valor === gasto.valor);
    if (dup && !(await confirmar(`Já existe um gasto de ${moeda(dup.valor)} em ${dataBR(dup.data)} ("${dup.descricao}").\nSalvar mesmo assim?`, { sim: 'Salvar' }))) return;
    const novas = form.fotos.filter(f => f.novo).map(f => ({ id: f.id, dados: f.dados, w: f.w, h: f.h, tipo: f.tipo, thumb: f.thumb }));
    try {
      await DB.salvarGasto(gasto, novas, form.removidas);
    } catch (err) {
      return erroForm('Não foi possível salvar: ' + (err && err.message ? err.message : err) + '. Verifique o espaço livre do celular.');
    }
    const i = estado.gastos.findIndex(g => g.id === gasto.id);
    if (i >= 0) estado.gastos[i] = gasto; else estado.gastos.push(gasto);
    // lembra Classificação/Fase do último gasto novo para pré-preencher os próximos
    if (!form.original && (gasto.classificacao !== estado.padroes.classificacao || gasto.fase !== estado.padroes.fase)) {
      estado.padroes = { classificacao: gasto.classificacao, fase: gasto.fase };
      DB.gravarConfig('padroes', estado.padroes).catch(() => {});
    }
    const [a, m] = gasto.mes.split('-').map(Number);
    fecharForm();
    // durante a fila o mês da tela não muda, para todas as fotos seguirem a mesma regra de mês
    if (estado.filaTotal && proximoDaFila()) {
      toast(`Salvo na planilha de ${nomeMes(a, m)} ✓ Próximo recibo`);
      return;
    }
    const outroMes = a !== estado.ano || m !== estado.mes;
    estado.ano = a;
    estado.mes = m;
    history.back();
    toast(outroMes ? `Gasto salvo na planilha de ${nomeMes(a, m)}` : 'Gasto salvo ✓');
  }

  async function excluirGasto() {
    const form = estado.form;
    if (!form || !form.original) return;
    if (!(await confirmar('Excluir este gasto e suas fotos?', { sim: 'Excluir' }))) return;
    await DB.excluirGastos([form.original]);
    estado.gastos = estado.gastos.filter(g => g.id !== form.original.id);
    fecharForm();
    history.back();
    toast('Gasto excluído');
  }

  // ---------- visor de foto ----------
  function abrirVisor(url) {
    $('visor-img').src = url;
    $('visor').hidden = false;
    history.pushState({ visor: true }, '');
  }
  function fecharVisor() {
    $('visor').hidden = true;
    $('visor-img').removeAttribute('src');
  }

  // ---------- exportar ----------
  function abrirExportar() {
    const gastos = doMes(estado.ano, estado.mes);
    const total = gastos.reduce((s, g) => s + g.valor, 0);
    $('exp-mes').textContent = nomeMes(estado.ano, estado.mes);
    $('exp-resumo').textContent = `${gastos.length} ${gastos.length === 1 ? 'gasto' : 'gastos'} · Total ${moeda(total)}`;
    const avisos = $('exp-avisos');
    avisos.textContent = '';
    const semFoto = gastos.filter(g => !(g.fotos || []).length).length;
    const semTipo = gastos.filter(g => !g.subclassificacao).length;
    if (semFoto) avisos.appendChild(el('li', '', `${semFoto} ${semFoto === 1 ? 'gasto está' : 'gastos estão'} sem foto do recibo.`));
    if (semTipo) avisos.appendChild(el('li', '', `${semTipo} ${semTipo === 1 ? 'gasto está' : 'gastos estão'} sem tipo de custo.`));
    const atrasados = gastos.filter(g => g.data.slice(0, 7) !== chaveMes(estado.ano, estado.mes)).length;
    if (atrasados) avisos.appendChild(el('li', 'info', `${atrasados} ${atrasados === 1 ? 'recibo é' : 'recibos são'} de outro mês e ${atrasados === 1 ? 'entra' : 'entram'} nesta planilha com a data original.`));
    const prazoM = estado.mes === 12 ? 1 : estado.mes + 1;
    const prazoA = estado.mes === 12 ? estado.ano + 1 : estado.ano;
    avisos.appendChild(el('li', 'info', `Prazo de envio: até 20/${pad(prazoM)}/${prazoA}, por e-mail, com a planilha e os recibos em PDF.`));
    $('btn-gerar').disabled = gastos.length === 0;
    $('btn-limpar-mes').hidden = gastos.length === 0;
    $('exp-arquivos').hidden = true;
    estado.arquivos = null;
    abrirSubtela('exportar');
  }

  const podeCompartilhar = arquivos => {
    try { return !!(navigator.canShare && navigator.canShare({ files: arquivos })); } catch (e) { return false; }
  };

  async function gerarArquivos() {
    const { ano, mes } = estado;
    const gastos = ordenar(doMes(ano, mes), false);
    if (!gastos.length) return;
    try {
      ocupado('Gerando a planilha…');
      const xlsx = await Exportar.gerarPlanilha(estado.perfil, ano, mes, gastos);
      ocupado('Montando o PDF dos recibos…');
      const pdf = await Exportar.gerarPDF(estado.perfil, nomeMes(ano, mes), gastos, id => DB.obter('fotos', id),
        (k, n) => ocupado(`Montando o PDF dos recibos… ${k}/${n}`));
      const sufixo = `${pad(mes)}${ano}`;
      estado.arquivos = {
        xlsx: new File([xlsx], `Planilha_reembolso_${sufixo}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        pdf: new File([pdf], `Recibos_reembolso_${sufixo}.pdf`, { type: 'application/pdf' }),
      };
      $('arq-xlsx-nome').textContent = estado.arquivos.xlsx.name;
      $('arq-pdf-nome').textContent = estado.arquivos.pdf.name;
      $('arq-xlsx-comp').hidden = !podeCompartilhar([estado.arquivos.xlsx]);
      $('arq-pdf-comp').hidden = !podeCompartilhar([estado.arquivos.pdf]);
      $('arq-ambos-comp').hidden = !podeCompartilhar([estado.arquivos.xlsx, estado.arquivos.pdf]);
      $('exp-arquivos').hidden = false;
      $('exp-arquivos').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      avisar('Não foi possível gerar os arquivos: ' + e.message);
    } finally {
      livre();
    }
  }

  function baixar(arquivo) {
    const url = URL.createObjectURL(arquivo);
    const a = document.createElement('a');
    a.href = url;
    a.download = arquivo.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('Arquivo salvo em Downloads');
  }

  async function compartilhar(arquivos) {
    try {
      await navigator.share({ files: arquivos, title: 'Reembolso ' + nomeMes(estado.ano, estado.mes) });
    } catch (e) {
      if (e && e.name !== 'AbortError') avisar('Não foi possível compartilhar. Use o botão Baixar.');
    }
  }

  async function limparMes() {
    const gastos = doMes(estado.ano, estado.mes);
    if (!gastos.length) return;
    const ok = await confirmar(`Excluir os ${gastos.length} gastos de ${nomeMes(estado.ano, estado.mes)} e suas fotos?\n\nFaça isso só depois de enviar a planilha. Não dá para desfazer.`, { sim: 'Excluir tudo' });
    if (!ok) return;
    await DB.excluirGastos(gastos);
    const ids = new Set(gastos.map(g => g.id));
    estado.gastos = estado.gastos.filter(g => !ids.has(g.id));
    history.back();
    toast('Gastos do mês excluídos');
  }

  // ---------- ajustes ----------
  function abrirAjustes() {
    const f = $('form-ajustes');
    f.nome.value = estado.perfil.nome;
    f.pix.value = estado.perfil.pix;
    f.classificacao.value = estado.padroes.classificacao || '';
    f.fase.value = estado.padroes.fase || '';
    f.pin.value = '';
    f.semPin.checked = !!estado.perfil.semPin || !estado.perfil.pinHash;
    abrirSubtela('ajustes');
  }

  async function salvarAjustes(e) {
    e.preventDefault();
    const f = e.target;
    const nome = f.nome.value.trim();
    const pix = f.pix.value.trim();
    const pin = f.pin.value.trim();
    if (!nome || !pix) return avisar('Preencha nome e dados bancários/PIX.');
    if (pin && !/^\d{4,6}$/.test(pin)) return avisar('O PIN deve ter de 4 a 6 números.');
    const p = Object.assign({}, estado.perfil, { nome, pix });
    if (pin) {
      p.pinSal = novoId();
      p.pinHash = hashPIN(pin, p.pinSal);
    }
    p.semPin = f.semPin.checked || !p.pinHash;
    estado.perfil = p;
    estado.padroes = { classificacao: f.classificacao.value, fase: f.fase.value };
    await DB.gravarConfig('perfil', p);
    await DB.gravarConfig('padroes', estado.padroes);
    history.back();
    toast('Ajustes salvos');
  }

  async function fazerBackup() {
    try {
      ocupado('Preparando o backup…');
      const perfil = { nome: estado.perfil.nome, pix: estado.perfil.pix };
      const blob = await Exportar.gerarBackup(perfil, estado.padroes, estado.gastos, id => DB.obter('fotos', id));
      const arquivo = new File([blob], `backup_reembolso_${isoLocal(new Date())}.zip`, { type: 'application/zip' });
      livre();
      if (podeCompartilhar([arquivo])) await compartilhar([arquivo]);
      else baixar(arquivo);
    } catch (e) {
      livre();
      avisar('Não foi possível gerar o backup: ' + e.message);
    }
  }

  async function restaurarBackup(e) {
    const arquivo = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!arquivo) return;
    try {
      ocupado('Lendo o backup…');
      const b = await Exportar.lerBackup(arquivo);
      livre();
      if (!(await confirmar(`Restaurar ${b.gastos.length} gastos e ${b.fotos.length} fotos deste backup?\nGastos que já existem aqui serão mantidos ou atualizados.`, { sim: 'Restaurar' }))) return;
      ocupado('Restaurando…');
      await DB.importar(b.gastos, b.fotos, {});
      estado.gastos = await DB.todos('gastos');
      livre();
      toast('Backup restaurado ✓');
    } catch (err) {
      livre();
      avisar('Não foi possível restaurar: ' + err.message);
    }
  }

  // ---------- service worker (funcionar offline + atualizações) ----------
  function registrarSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(reg => {
      estado.sw = reg;
      const verificar = () => { if (reg.waiting && navigator.serviceWorker.controller) $('aviso-atualizacao').hidden = false; };
      verificar();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') verificar(); });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(err => console.warn('SW', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (estado.atualizando) location.reload();
    });
  }

  async function atualizarApp() {
    if (estado.form && estado.form.alterado && !(await confirmar('Há um gasto não salvo. Atualizar mesmo assim?', { sim: 'Atualizar' }))) return;
    const reg = estado.sw;
    if (reg && reg.waiting) {
      estado.atualizando = true;
      reg.waiting.postMessage('atualizar');
    } else {
      location.reload();
    }
  }

  // ---------- eventos ----------
  function ligarEventos() {
    $('form-cadastro').addEventListener('submit', salvarCadastro);
    $('form-pin').addEventListener('submit', conferirPIN);
    $('pin-esqueci').addEventListener('click', esqueciPIN);
    $('mes-ant').addEventListener('click', () => mudarMes(-1));
    $('mes-prox').addEventListener('click', () => mudarMes(1));
    $('btn-camera').addEventListener('click', () => escolherFoto('novo', 'in-camera'));
    $('btn-galeria').addEventListener('click', () => escolherFoto('novo', 'in-galeria'));
    $('btn-sem-foto').addEventListener('click', () => abrirFormNovo(null));
    $('btn-exportar').addEventListener('click', abrirExportar);
    $('btn-ajustes').addEventListener('click', abrirAjustes);
    $('in-camera').addEventListener('change', aoEscolherArquivo);
    $('in-galeria').addEventListener('change', aoEscolherArquivo);
    for (const b of document.querySelectorAll('.voltar')) b.addEventListener('click', () => history.back());

    const fg = $('form-gasto');
    fg.addEventListener('submit', salvarGasto);
    fg.addEventListener('input', ev => {
      if (!estado.form || !ev.target.name) return;
      estado.form.tocados.add(ev.target.name);
      estado.form.alterado = true;
      ev.target.classList.remove('campo-auto');
      if (ev.target.name === 'data') atualizarMesAuto();
      if (ev.target.name === 'mes') atualizarAvisoMes();
    });
    fg.addEventListener('change', ev => {
      if (!estado.form || !ev.target.name) return;
      estado.form.tocados.add(ev.target.name);
      estado.form.alterado = true;
    });
    fg.elements.valor.addEventListener('blur', () => {
      const v = lerValor(fg.elements.valor.value);
      if (v) fg.elements.valor.value = formatarValor(v);
    });
    $('chips-tipo').addEventListener('click', ev => {
      const b = ev.target.closest('.chip');
      if (!b || !estado.form) return;
      estado.form.tipo = estado.form.tipo === b.dataset.tipo ? '' : b.dataset.tipo;
      estado.form.tocados.add('tipo');
      estado.form.alterado = true;
      renderChips();
    });
    $('btn-excluir').addEventListener('click', excluirGasto);
    $('btn-pular').addEventListener('click', pularFoto);

    $('btn-gerar').addEventListener('click', gerarArquivos);
    $('arq-xlsx-baixar').addEventListener('click', () => estado.arquivos && baixar(estado.arquivos.xlsx));
    $('arq-pdf-baixar').addEventListener('click', () => estado.arquivos && baixar(estado.arquivos.pdf));
    $('arq-xlsx-comp').addEventListener('click', () => estado.arquivos && compartilhar([estado.arquivos.xlsx]));
    $('arq-pdf-comp').addEventListener('click', () => estado.arquivos && compartilhar([estado.arquivos.pdf]));
    $('arq-ambos-comp').addEventListener('click', () => estado.arquivos && compartilhar([estado.arquivos.xlsx, estado.arquivos.pdf]));
    $('btn-limpar-mes').addEventListener('click', limparMes);

    const fa = $('form-ajustes');
    fa.addEventListener('submit', salvarAjustes);
    fa.elements.pin.addEventListener('input', () => { if (fa.elements.pin.value) fa.elements.semPin.checked = false; });
    $('btn-backup').addEventListener('click', fazerBackup);
    $('btn-restaurar').addEventListener('click', () => { const i = $('in-backup'); i.value = ''; i.click(); });
    $('in-backup').addEventListener('change', restaurarBackup);

    $('visor-fechar').addEventListener('click', () => history.back());
    $('btn-atualizar').addEventListener('click', atualizarApp);
  }

  iniciar();
})();
