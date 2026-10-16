/* App Reembolso: telas, formulário e fluxo principal. */
(() => {
  const VERSAO = '1.5.0';
  // Classificação (lista da empresa). As três primeiras aparecem direto; as outras ficam em "Outras".
  const CLASSIFICACOES = ['Alimentação', 'Transporte', 'Hospedagem', 'Insumos', 'Equipamentos', 'EPI', 'Prestação de serviço', 'Plataformas', 'República Reflora', 'Salário', 'VERRA'];
  const PRINCIPAIS = 3;
  const FASES = ['Implantação', 'Acompanhamento e manutenção'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DESCRICOES_COMUNS = ['Café da manhã', 'Almoço', 'Lanche', 'Janta', 'Deslocamento (Uber)', 'Deslocamento (99)', 'Combustível', 'Estacionamento', 'Pedágio', 'Passagem de ônibus', 'Hospedagem'];
  const TELAS = ['cadastro', 'pin', 'lista', 'gasto', 'exportar', 'ajustes'];
  const DIA_DE_CORTE = 20; // a planilha vai até o dia 20 de cada mês

  const $ = id => document.getElementById(id);
  const estado = {
    perfil: null,
    padroes: { fase: '' },
    ano: 0, // sem filtro, a tela mostra um mês
    mes: 0,
    filtro: null, // { de, ate } quando há período escolhido no calendário
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
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const el = (tag, cls, texto) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  // ---------- período do reembolso ----------
  // Ciclo: do dia 20 do mês anterior até hoje (depois do dia 20, começa no dia 20 deste mês).
  function periodoPadrao() {
    const h = new Date();
    const inicio = h.getDate() <= DIA_DE_CORTE
      ? new Date(h.getFullYear(), h.getMonth() - 1, DIA_DE_CORTE)
      : new Date(h.getFullYear(), h.getMonth(), DIA_DE_CORTE);
    return { de: isoLocal(inicio), ate: isoLocal(h) };
  }
  // O que aparece na tela (e vai para a planilha): o período filtrado ou, sem filtro, o mês escolhido.
  const chaveMes = () => `${estado.ano}-${pad(estado.mes)}`;
  const visivel = g => (estado.filtro
    ? g.data >= estado.filtro.de && g.data <= estado.filtro.ate
    : g.data.slice(0, 7) === chaveMes());
  const visiveis = () => estado.gastos.filter(visivel);
  // só faz sentido avisar de recibos esquecidos quando há um período filtrado
  const naoEnviadosFora = () => (estado.filtro ? estado.gastos.filter(g => !g.enviadoEm && !visivel(g)) : []);
  const rotuloVisivel = () => (estado.filtro
    ? `${dataBR(estado.filtro.de)} a ${dataBR(estado.filtro.ate)}`
    : nomeMes(estado.ano, estado.mes));

  // Mês da planilha (cabeçalho "Mês/ano" e nome do arquivo): com filtro, o mês do prazo de envio
  // do período (dia 20); sem filtro, o próprio mês mostrado.
  function mesDaPlanilha() {
    if (!estado.filtro) return { ano: estado.ano, mes: estado.mes, prazo: null };
    const [a, m, d] = estado.filtro.ate.split('-').map(Number);
    const p = d <= DIA_DE_CORTE ? new Date(a, m - 1, DIA_DE_CORTE) : new Date(a, m, DIA_DE_CORTE);
    return { ano: p.getFullYear(), mes: p.getMonth() + 1, prazo: isoLocal(p) };
  }

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
    if (!$('calendario').hidden) { $('calendario').hidden = true; return; }
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
    try {
      estado.perfil = await DB.lerConfig('perfil');
      estado.padroes = Object.assign({ fase: '' }, await DB.lerConfig('padroes'));
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
    const hoje = new Date();
    estado.ano = hoje.getFullYear();
    estado.mes = hoje.getMonth() + 1;
    estado.filtro = null;
    history.replaceState({ tela: 'lista' }, '');
    mostrar('lista');
    renderLista();
  }

  function preencherSelects() {
    for (const f of [$('form-gasto'), $('form-ajustes')]) {
      const sel = f.elements.fase;
      sel.textContent = '';
      sel.appendChild(new Option('—', ''));
      for (const item of FASES) sel.appendChild(new Option(item, item));
    }
    const chip = tipo => {
      const b = el('button', 'chip', tipo);
      b.type = 'button';
      b.dataset.tipo = tipo;
      b.setAttribute('aria-pressed', 'false');
      return b;
    };
    CLASSIFICACOES.slice(0, PRINCIPAIS).forEach(t => $('chips-tipo').appendChild(chip(t)));
    const mais = el('button', 'chip chip-mais', 'Outras ▾');
    mais.type = 'button';
    mais.id = 'chip-mais';
    $('chips-tipo').appendChild(mais);
    CLASSIFICACOES.slice(PRINCIPAIS).forEach(t => $('chips-outras').appendChild(chip(t)));
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

  // ---------- lista do período ----------
  const ordenar = (lista, desc) => lista.slice().sort((x, y) =>
    (x.data === y.data ? (x.criadoEm || '').localeCompare(y.criadoEm || '') : x.data.localeCompare(y.data)) * (desc ? -1 : 1));

  function renderLista() {
    const gastos = ordenar(visiveis(), true);
    const total = gastos.reduce((s, g) => s + g.valor, 0);
    const f = estado.filtro;
    $('mes-nav').hidden = !!f;
    $('mes-nome').textContent = nomeMes(estado.ano, estado.mes);
    $('per-texto').textContent = f ? `${dataBR(f.de)} → ${dataBR(f.ate)}` : 'Filtrar por período';
    $('per-botao').classList.toggle('ativo', !!f);
    $('per-botao').classList.toggle('sem-filtro', !f);
    $('per-limpar').hidden = !f;
    $('lista-vazia-titulo').textContent = f ? 'Nenhum gasto neste período.' : 'Nenhum gasto neste mês.';
    const resumo = $('per-resumo');
    resumo.textContent = `${plural(gastos.length, 'recibo', 'recibos')} · Total `;
    resumo.appendChild(el('strong', '', moeda(total)));

    // recibos ainda não enviados que ficaram fora do período escolhido
    const fora = naoEnviadosFora();
    const aviso = $('per-aviso');
    aviso.hidden = !fora.length;
    if (fora.length) {
      aviso.textContent = `⚠ ${plural(fora.length, 'recibo não enviado está', 'recibos não enviados estão')} fora deste período. Toque para incluir.`;
    }

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
      const info = el('div', 'item-info', `${dataBR(g.data).slice(0, 5)} · ${g.subclassificacao || ''}`);
      if (!g.subclassificacao) info.appendChild(el('span', 'tag-aviso', 'sem classificação'));
      if (g.enviadoEm) info.appendChild(el('span', 'tag-enviado', ' · ✓ enviado'));
      meio.appendChild(info);
      li.appendChild(meio);
      li.appendChild(el('div', 'item-valor', moeda(g.valor)));
      li.addEventListener('click', () => abrirFormEdicao(g.id));
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter') abrirFormEdicao(g.id); });
      ul.appendChild(li);
    }
    $('lista-vazia').hidden = gastos.length > 0;
  }

  // ---------- calendário para escolher o período ----------
  // 1º toque marca o início, 2º toque o fim; um novo toque recomeça a seleção.
  const cal = { de: '', ate: '' };

  // Abre com o filtro atual marcado; sem filtro, abre vazio no mês que está na tela.
  function abrirCalendario() {
    cal.de = estado.filtro ? estado.filtro.de : '';
    cal.ate = estado.filtro ? estado.filtro.ate : '';
    montarCalendario();
    $('calendario').hidden = false;
    history.pushState({ calendario: true }, '');
    const mesAlvo = cal.de ? cal.de.slice(0, 7) : chaveMes();
    const alvo = document.querySelector(`.cal-mes[data-mes="${mesAlvo}"]`) || document.querySelector('.cal-mes:last-child');
    if (alvo) alvo.scrollIntoView({ block: 'start' });
  }

  function montarCalendario() {
    const box = $('cal-meses');
    box.textContent = '';
    const hoje = new Date();
    const hojeIso = isoLocal(hoje);
    // do mês do recibo mais antigo (ou 12 meses atrás) até o mês atual
    const antigo = estado.gastos.reduce((m, g) => (g.data < m ? g.data : m), isoLocal(new Date(hoje.getFullYear(), hoje.getMonth() - 12, 1)));
    let mes = new Date(+antigo.slice(0, 4), +antigo.slice(5, 7) - 1, 1);
    const ultimo = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const comRecibo = new Set(estado.gastos.map(g => g.data));
    while (mes <= ultimo) {
      const a = mes.getFullYear(), m = mes.getMonth() + 1;
      const sec = el('section', 'cal-mes');
      sec.dataset.mes = `${a}-${pad(m)}`;
      sec.appendChild(el('h3', 'cal-mes-nome', nomeMes(a, m)));
      const grade = el('div', 'cal-grade');
      for (let i = 0; i < mes.getDay(); i++) grade.appendChild(el('div'));
      const dias = new Date(a, m, 0).getDate();
      for (let d = 1; d <= dias; d++) {
        const iso = `${a}-${pad(m)}-${pad(d)}`;
        const b = el('button', 'cal-dia');
        b.type = 'button';
        b.dataset.iso = iso;
        b.appendChild(el('span', '', String(d)));
        if (iso === hojeIso) b.classList.add('hoje');
        if (iso > hojeIso) b.classList.add('futuro');
        if (comRecibo.has(iso)) b.classList.add('com-recibo');
        grade.appendChild(b);
      }
      sec.appendChild(grade);
      box.appendChild(sec);
      mes = new Date(a, m, 1);
    }
    marcarSelecao();
  }

  function marcarSelecao() {
    for (const b of document.querySelectorAll('#cal-meses .cal-dia')) {
      const iso = b.dataset.iso;
      b.classList.toggle('inicio', iso === cal.de);
      b.classList.toggle('fim', !!cal.ate && iso === cal.ate);
      b.classList.toggle('meio', !!cal.ate && iso > cal.de && iso < cal.ate);
      b.classList.toggle('com-fim', !!cal.ate && cal.ate !== cal.de);
      b.classList.toggle('com-inicio', !!cal.ate && cal.ate !== cal.de);
    }
    const resumo = $('cal-resumo');
    if (!cal.de) {
      resumo.textContent = 'Toque no primeiro dia do período';
    } else if (!cal.ate) {
      resumo.textContent = `Início: ${dataBR(cal.de)} — agora toque no último dia`;
    } else {
      const gastos = estado.gastos.filter(g => g.data >= cal.de && g.data <= cal.ate);
      const total = gastos.reduce((t, g) => t + g.valor, 0);
      resumo.textContent = `${dataBR(cal.de)} a ${dataBR(cal.ate)} · ${plural(gastos.length, 'recibo', 'recibos')} · ${moeda(total)}`;
    }
    $('cal-aplicar').disabled = !cal.de;
  }

  function tocarDia(iso) {
    if (!cal.de || cal.ate) {
      cal.de = iso;
      cal.ate = '';
    } else if (iso < cal.de) {
      cal.de = iso;
    } else {
      cal.ate = iso;
    }
    marcarSelecao();
  }

  function atalhoPeriodo(qual) {
    const atual = periodoPadrao();
    if (qual === 'atual') {
      Object.assign(cal, atual);
    } else if (qual === 'anterior') {
      // ciclo anterior: do dia 20 do mês antes do ciclo atual até a véspera do ciclo atual
      const [a, m] = atual.de.split('-').map(Number);
      cal.de = isoLocal(new Date(a, m - 2, DIA_DE_CORTE));
      cal.ate = isoLocal(new Date(a, m - 1, DIA_DE_CORTE - 1));
    } else {
      const datas = estado.gastos.map(g => g.data).sort();
      cal.de = datas.length ? datas[0] : atual.de;
      cal.ate = datas.length && datas[datas.length - 1] > atual.ate ? datas[datas.length - 1] : atual.ate;
    }
    marcarSelecao();
    const alvo = document.querySelector(`.cal-mes[data-mes="${cal.de.slice(0, 7)}"]`);
    if (alvo) alvo.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function aplicarCalendario() {
    if (!cal.de) return;
    estado.filtro = { de: cal.de, ate: cal.ate || cal.de };
    history.back(); // fecha o calendário
    renderLista();
  }

  function limparCalendario() {
    estado.filtro = null;
    history.back(); // fecha o calendário
    renderLista();
  }

  function incluirForaDoPeriodo() {
    const datas = naoEnviadosFora().map(g => g.data).concat([estado.filtro.de, estado.filtro.ate]).sort();
    estado.filtro = { de: datas[0], ate: datas[datas.length - 1] };
    renderLista();
  }

  function mudarMes(delta) {
    const d = new Date(estado.ano, estado.mes - 1 + delta, 1);
    estado.ano = d.getFullYear();
    estado.mes = d.getMonth() + 1;
    renderLista();
  }

  function limparFiltro() {
    estado.filtro = null;
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
    c.fase.value = gasto ? gasto.fase || '' : estado.padroes.fase || '';
    for (const x of $('form-gasto').querySelectorAll('.campo-auto')) x.classList.remove('campo-auto');
    const naFila = !gasto && estado.filaTotal > 0;
    $('gasto-titulo').textContent = gasto ? 'Editar gasto'
      : naFila ? `Recibo ${estado.filaTotal - estado.fila.length} de ${estado.filaTotal}` : 'Novo gasto';
    $('btn-pular').hidden = !naFila;
    $('btn-excluir').hidden = !gasto;
    $('gasto-erro').hidden = true;
    $('chips-outras').hidden = true;
    esconderLeitura();
    renderChips();
    renderFotos();
    atualizarSugestoes();
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
        if (d <= new Date()) campos().data.value = isoLocal(d);
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
    const tipo = estado.form.tipo;
    for (const b of document.querySelectorAll('#chips-tipo .chip[data-tipo], #chips-outras .chip')) {
      b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo));
    }
    // se a classificação escolhida está entre as "Outras", mostra a lista aberta
    if (CLASSIFICACOES.indexOf(tipo) >= PRINCIPAIS) $('chips-outras').hidden = false;
    $('chip-mais').textContent = $('chips-outras').hidden ? 'Outras ▾' : 'Outras ▴';
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

  // Preenche só: valor, classificação, data, despesa e link da NF (a observação fica para o usuário).
  function aplicarLeitura(r) {
    const form = estado.form;
    const achouValor = preencherAuto('valor', r.valor ? formatarValor(r.valor) : '');
    preencherAuto('data', r.data);
    // sem pista do tipo, mas a nota foi lida: quase sempre é alimentação
    const tipo = r.tipo || (r.valor ? 'Alimentação' : '');
    if (tipo && !form.tocados.has('tipo')) {
      form.tipo = tipo;
      renderChips();
    }
    preencherAuto('descricao', r.descricao || (tipo === 'Alimentação' ? Leitura.refeicaoPorHora(r.hora) : ''));
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
    const o = form.original;
    const gasto = {
      id: form.id || novoId(),
      data,
      valor,
      descricao: c.descricao.value.trim() || form.tipo || 'Despesa',
      observacao: c.observacao.value.trim(),
      subclassificacao: form.tipo, // a "Classificação" escolhida (vai na coluna Classificação da planilha)
      fase: c.fase.value,
      link: c.link.value.trim(),
      fotos: form.fotos.map(f => f.id),
      thumb: form.fotos.length ? form.fotos[0].thumb : '',
      criadoEm: o ? o.criadoEm : agora,
      atualizadoEm: agora,
    };
    if (o && o.enviadoEm) gasto.enviadoEm = o.enviadoEm;
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
    // lembra a Fase do último gasto novo para pré-preencher os próximos
    if (!o && gasto.fase !== estado.padroes.fase) {
      estado.padroes = { fase: gasto.fase };
      DB.gravarConfig('padroes', estado.padroes).catch(() => {});
    }
    fecharForm();
    const fora = !visivel(gasto);
    if (estado.filaTotal && proximoDaFila()) {
      toast(fora ? `Salvo (${dataBR(gasto.data)}, fora da tela atual) ✓ Próximo recibo` : 'Gasto salvo ✓ Próximo recibo');
      return;
    }
    let msg = 'Gasto salvo ✓';
    if (fora && !estado.filtro) {
      // sem filtro: mostra o mês do recibo que acabou de ser salvo
      estado.ano = +gasto.data.slice(0, 4);
      estado.mes = +gasto.data.slice(5, 7);
      msg = `Gasto salvo em ${nomeMes(estado.ano, estado.mes)}`;
    } else if (fora) {
      msg = `Gasto salvo. A data ${dataBR(gasto.data)} está fora do período filtrado.`;
    }
    history.back();
    toast(msg);
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
    const gastos = visiveis();
    const total = gastos.reduce((s, g) => s + g.valor, 0);
    const planilha = mesDaPlanilha();
    $('exp-mes').textContent = rotuloVisivel();
    $('exp-resumo').textContent = `${plural(gastos.length, 'gasto', 'gastos')} · Total ${moeda(total)}` +
      (estado.filtro ? ` · Planilha de ${nomeMes(planilha.ano, planilha.mes).toLowerCase()}` : '');
    const avisos = $('exp-avisos');
    avisos.textContent = '';
    const semFoto = gastos.filter(g => !(g.fotos || []).length).length;
    const semTipo = gastos.filter(g => !g.subclassificacao).length;
    const enviados = gastos.filter(g => g.enviadoEm).length;
    const fora = naoEnviadosFora().length;
    if (semFoto) avisos.appendChild(el('li', '', `${plural(semFoto, 'gasto está', 'gastos estão')} sem foto do recibo.`));
    if (semTipo) avisos.appendChild(el('li', '', `${plural(semTipo, 'gasto está', 'gastos estão')} sem classificação.`));
    if (enviados) avisos.appendChild(el('li', '', `${plural(enviados, 'gasto já foi marcado', 'gastos já foram marcados')} como enviado.`));
    if (fora) avisos.appendChild(el('li', '', `${plural(fora, 'recibo não enviado ficou', 'recibos não enviados ficaram')} fora deste período (veja na tela anterior).`));
    avisos.appendChild(el('li', 'info', planilha.prazo
      ? `Prazo de envio: até ${dataBR(planilha.prazo)}, por e-mail, com a planilha e os recibos em PDF.`
      : 'Dica: para a planilha do ciclo de reembolso (do dia 20 ao dia 20), volte e use “Filtrar por período”.'));
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
    const gastos = ordenar(visiveis(), false);
    if (!gastos.length) return;
    const planilha = mesDaPlanilha();
    try {
      ocupado('Gerando a planilha…');
      const xlsx = await Exportar.gerarPlanilha(estado.perfil, planilha.ano, planilha.mes, gastos);
      ocupado('Montando o PDF dos recibos…');
      const rotulo = estado.filtro ? 'Período ' + rotuloVisivel() : rotuloVisivel();
      const pdf = await Exportar.gerarPDF(estado.perfil, rotulo, gastos, id => DB.obter('fotos', id),
        (k, n) => ocupado(`Montando o PDF dos recibos… ${k}/${n}`));
      const sufixo = `${pad(planilha.mes)}${planilha.ano}`;
      estado.arquivos = {
        xlsx: new File([xlsx], `Planilha_reembolso_${sufixo}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        pdf: new File([pdf], `Recibos_reembolso_${sufixo}.pdf`, { type: 'application/pdf' }),
      };
      $('arq-xlsx-nome').textContent = estado.arquivos.xlsx.name;
      $('arq-pdf-nome').textContent = estado.arquivos.pdf.name;
      // planilha (.xlsx) não pode ser compartilhada pelo navegador no Android: só o PDF tem "Enviar"
      $('arq-pdf-comp').hidden = !podeCompartilhar([estado.arquivos.pdf]);
      atualizarBotaoEnviados();
      $('exp-arquivos').hidden = false;
      $('exp-arquivos').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      avisar('Não foi possível gerar os arquivos: ' + e.message);
    } finally {
      livre();
    }
  }

  function atualizarBotaoEnviados() {
    const pendentes = visiveis().filter(g => !g.enviadoEm).length;
    $('exp-enviar').hidden = !pendentes;
    $('btn-marcar-enviados').textContent = `Marcar ${plural(pendentes, 'recibo', 'recibos')} como ${pendentes === 1 ? 'enviado' : 'enviados'}`;
  }

  async function marcarEnviados() {
    const pendentes = visiveis().filter(g => !g.enviadoEm);
    if (!pendentes.length) return;
    if (!(await confirmar(`Marcar ${plural(pendentes.length, 'recibo', 'recibos')} (${rotuloVisivel()}) como ${pendentes.length === 1 ? 'enviado' : 'enviados'}?\nFaça isso depois de mandar o e-mail.`, { sim: 'Marcar' }))) return;
    const hoje = isoLocal(new Date());
    const atualizados = pendentes.map(g => Object.assign({}, g, { enviadoEm: hoje }));
    await DB.gravarGastos(atualizados);
    const porId = new Map(atualizados.map(g => [g.id, g]));
    estado.gastos = estado.gastos.map(g => porId.get(g.id) || g);
    atualizarBotaoEnviados();
    toast('Recibos marcados como enviados ✓');
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
      await navigator.share({ files: arquivos, title: 'Reembolso ' + rotuloVisivel() });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // a pessoa fechou a lista de apps
      for (const a of arquivos) baixar(a);
      avisar('O celular não deixou compartilhar direto, então o arquivo foi salvo na pasta Download.\nNo WhatsApp: toque no clipe 📎 → Documento e escolha o arquivo.');
    }
  }

  async function limparPeriodo() {
    const gastos = visiveis();
    if (!gastos.length) return;
    const ok = await confirmar(`Excluir os ${gastos.length} gastos de ${rotuloVisivel()} e suas fotos?\n\nFaça isso só depois de enviar a planilha. Não dá para desfazer.`, { sim: 'Excluir tudo' });
    if (!ok) return;
    await DB.excluirGastos(gastos);
    const ids = new Set(gastos.map(g => g.id));
    estado.gastos = estado.gastos.filter(g => !ids.has(g.id));
    history.back();
    toast('Gastos excluídos');
  }

  // ---------- ajustes ----------
  function abrirAjustes() {
    const f = $('form-ajustes');
    f.nome.value = estado.perfil.nome;
    f.pix.value = estado.perfil.pix;
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
    estado.padroes = { fase: f.fase.value };
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
      baixar(arquivo);
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
    $('per-botao').addEventListener('click', abrirCalendario);
    $('cal-fechar').addEventListener('click', () => history.back());
    $('cal-aplicar').addEventListener('click', aplicarCalendario);
    $('cal-meses').addEventListener('click', ev => {
      const b = ev.target.closest('.cal-dia');
      if (b) tocarDia(b.dataset.iso);
    });
    for (const b of document.querySelectorAll('.cal-atalhos .chip')) b.addEventListener('click', () => atalhoPeriodo(b.dataset.atalho));
    $('per-limpar').addEventListener('click', limparFiltro);
    $('mes-ant').addEventListener('click', () => mudarMes(-1));
    $('mes-prox').addEventListener('click', () => mudarMes(1));
    $('cal-limpar').addEventListener('click', limparCalendario);
    $('per-aviso').addEventListener('click', incluirForaDoPeriodo);
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
    const aoTocarChip = ev => {
      const b = ev.target.closest('.chip');
      if (!b || !estado.form) return;
      if (b.id === 'chip-mais') {
        $('chips-outras').hidden = !$('chips-outras').hidden;
        return renderChips();
      }
      estado.form.tipo = estado.form.tipo === b.dataset.tipo ? '' : b.dataset.tipo;
      estado.form.tocados.add('tipo');
      estado.form.alterado = true;
      renderChips();
    };
    $('chips-tipo').addEventListener('click', aoTocarChip);
    $('chips-outras').addEventListener('click', aoTocarChip);
    $('btn-excluir').addEventListener('click', excluirGasto);
    $('btn-pular').addEventListener('click', pularFoto);

    $('btn-gerar').addEventListener('click', gerarArquivos);
    $('arq-xlsx-baixar').addEventListener('click', () => estado.arquivos && baixar(estado.arquivos.xlsx));
    $('arq-pdf-baixar').addEventListener('click', () => estado.arquivos && baixar(estado.arquivos.pdf));
    $('arq-pdf-comp').addEventListener('click', () => estado.arquivos && compartilhar([estado.arquivos.pdf]));
    $('btn-marcar-enviados').addEventListener('click', marcarEnviados);
    $('btn-limpar-mes').addEventListener('click', limparPeriodo);

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
