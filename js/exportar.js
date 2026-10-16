/* Geração dos arquivos: planilha no modelo da empresa (template.xlsx), PDF dos recibos e backup. */
const Exportar = (() => {
  const LINHA_INICIAL = 7;
  const LINHA_MINIMA_FINAL = 32; // o modelo tem linhas com borda até a 32
  const SEM_PASTAS = { createFolders: false }; // evita entradas de pasta vazias no .xlsx

  const esc = s => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Número de série de data do Excel
  function serialExcel(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  const celTexto = (ref, estilo, texto) => (texto
    ? `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${esc(texto)}</t></is></c>`
    : `<c r="${ref}" s="${estilo}"/>`);
  const celNum = (ref, estilo, n) => `<c r="${ref}" s="${estilo}"><v>${n}</v></c>`;
  const ehURL = s => /^https?:\/\/\S+$/i.test(s || '');

  function montarLinhas(perfil, ano, mes, gastos) {
    const linhas = [];
    const L = 'spans="2:9" x14ac:dyDescent="0.35"';
    linhas.push(`<row r="1" ${L} ht="15.5"><c r="B1" s="22" t="s"><v>0</v></c>` +
      ['C', 'D', 'E', 'F', 'G', 'H', 'I'].map(c => `<c r="${c}1" s="23"/>`).join('') + '</row>');
    linhas.push(`<row r="2" ${L} ht="13" customHeight="1"/>`);
    linhas.push(`<row r="3" ${L}>${celTexto('B3', 0, 'Pagador: ' + (perfil.nome || ''))}</row>`);
    linhas.push(`<row r="4" ${L}><c r="B4" t="s"><v>2</v></c>${celNum('C4', 5, serialExcel(`${ano}-${String(mes).padStart(2, '0')}-01`))}<c r="D4" s="3"/></row>`);
    linhas.push(`<row r="5" ${L}>${celTexto('B5', 0, 'Dados bancários/PIX: ' + (perfil.pix || ''))}</row>`);
    const cab = [['B', 4, 4], ['C', 4, 5], ['D', 4, 6], ['E', 4, 7], ['F', 4, 8], ['G', 15, 9], ['H', 6, 10], ['I', 6, 11]];
    linhas.push(`<row r="6" ${L}>` + cab.map(([c, s, v]) => `<c r="${c}6" s="${s}" t="s"><v>${v}</v></c>`).join('') + '</row>');

    const links = [];
    let r = LINHA_INICIAL;
    let total = 0;
    for (const g of gastos) {
      total += g.valor;
      // URL da NF vira um link clicável curto, para não invadir as outras colunas
      const celLink = celTexto(`I${r}`, 13, ehURL(g.link) ? 'Acessar NF' : g.link);
      if (ehURL(g.link)) links.push({ ref: `I${r}`, url: g.link });
      linhas.push(`<row r="${r}" ${L}>` +
        celTexto(`B${r}`, 7, g.descricao) +
        celTexto(`C${r}`, 7, g.observacao) +
        celTexto(`D${r}`, 7, g.classificacao) +
        celTexto(`E${r}`, 7, g.subclassificacao) +
        celTexto(`F${r}`, 7, g.fase) +
        celNum(`G${r}`, 14, serialExcel(g.data)) +
        celNum(`H${r}`, 12, (g.valor / 100).toFixed(2).replace(/\.?0+$/, '')) +
        celLink + '</row>');
      r++;
    }
    const ultima = Math.max(r - 1, LINHA_MINIMA_FINAL);
    for (; r <= ultima; r++) {
      linhas.push(`<row r="${r}" ${L}>` +
        ['B', 'C', 'D', 'E', 'F'].map(c => `<c r="${c}${r}" s="7"/>`).join('') +
        `<c r="G${r}" s="14"/><c r="H${r}" s="12"/><c r="I${r}" s="13"/></row>`);
    }
    const t = ultima + 2;
    linhas.push(`<row r="${t}" ${L}>` +
      ['B', 'C', 'D', 'E', 'F'].map(c => `<c r="${c}${t}" s="9"/>`).join('') +
      `<c r="G${t}" s="16"/><c r="H${t}" s="11"><f>SUM(H${LINHA_INICIAL}:H${ultima})</f><v>${(total / 100).toFixed(2)}</v></c><c r="I${t}" s="9"/></row>`);
    return { xml: linhas.join(''), ultima, linhaTotal: t, links };
  }

  async function gerarPlanilha(perfil, ano, mes, gastos) {
    const resp = await fetch('template.xlsx');
    if (!resp.ok) throw new Error('Modelo da planilha não encontrado.');
    const zip = await JSZip.loadAsync(await resp.arrayBuffer(), { createFolders: false });
    const { xml, ultima, linhaTotal, links } = montarLinhas(perfil, ano, mes, gastos);

    let folha = await zip.file('xl/worksheets/sheet1.xml').async('string');
    folha = folha.replace(/<sheetData>[\s\S]*<\/sheetData>|<sheetData\/>/, `<sheetData>${xml}</sheetData>`);
    folha = folha.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="B1:I${linhaTotal}"/>`);
    folha = folha.replace(/<autoFilter ref="[^"]*"/, `<autoFilter ref="B6:I${ultima}"`);
    folha = folha.replace(/<xm:sqref>([DEF])\d+:[DEF]\d+<\/xm:sqref>/g, `<xm:sqref>$1${LINHA_INICIAL}:$1${ultima}</xm:sqref>`);
    folha = folha.replace(/<hyperlinks>[\s\S]*?<\/hyperlinks>/, '');

    let rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels').async('string');
    rels = rels.replace(/<Relationship Id="rIdNF\d+"[^>]*\/>/g, '');
    if (links.length) {
      const hl = links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rIdNF${i + 1}"/>`).join('');
      folha = folha.replace('<pageMargins', `<hyperlinks>${hl}</hyperlinks><pageMargins`);
      const novas = links.map((l, i) =>
        `<Relationship Id="rIdNF${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join('');
      rels = rels.replace('</Relationships>', novas + '</Relationships>');
    }
    zip.file('xl/worksheets/sheet1.xml', folha, SEM_PASTAS);
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', rels, SEM_PASTAS);

    let wb = await zip.file('xl/workbook.xml').async('string');
    wb = wb.replace(/\$B\$6:\$I\$\d+/, `$B$6:$I$${ultima}`);
    zip.file('xl/workbook.xml', wb, SEM_PASTAS);

    const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    let core = await zip.file('docProps/core.xml').async('string');
    core = core.replace(/(<dcterms:modified[^>]*>)[^<]*/, `$1${agora}`)
      .replace(/<cp:lastModifiedBy>[^<]*/, `<cp:lastModifiedBy>${esc(perfil.nome || 'App Reembolso')}`);
    zip.file('docProps/core.xml', core, SEM_PASTAS);

    return zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  const dataBR = iso => iso.split('-').reverse().join('/');
  const moeda = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  async function gerarPDF(perfil, nomeMes, gastos, obterFoto, aoProgredir) {
    await Leitura.carregarScript('vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const totalFotos = gastos.reduce((s, g) => s + (g.fotos || []).length, 0);
    let feitas = 0;
    let primeira = true;
    for (let i = 0; i < gastos.length; i++) {
      const g = gastos[i];
      const fotos = g.fotos || [];
      for (let k = 0; k < fotos.length; k++) {
        const foto = await obterFoto(fotos[k]);
        if (!foto) continue;
        if (!primeira) doc.addPage();
        primeira = false;
        const parte = fotos.length > 1 ? ` (foto ${k + 1}/${fotos.length})` : '';
        const titulo = `Recibo ${i + 1}${parte} - ${dataBR(g.data)} - ${moeda(g.valor)}`;
        const desc = [g.descricao, g.subclassificacao].filter(Boolean).join(' · ');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(titulo, 10, 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(doc.splitTextToSize(desc, 190)[0] || '', 10, 17.5);
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(`${perfil.nome || ''} - ${nomeMes}`, 200, 12, { align: 'right' });
        doc.setTextColor(0);
        const areaW = 190, areaH = 270, topo = 22;
        const fator = Math.min(areaW / foto.w, areaH / foto.h);
        const w = foto.w * fator, h = foto.h * fator;
        doc.addImage(new Uint8Array(foto.dados), 'JPEG', 10 + (areaW - w) / 2, topo, w, h, undefined, 'NONE');
        feitas++;
        if (aoProgredir) aoProgredir(feitas, totalFotos);
      }
    }
    if (primeira) {
      doc.setFontSize(14);
      doc.text(`Nenhum comprovante com foto em ${nomeMes}.`, 10, 20);
    }
    return doc.output('blob');
  }

  // ---------- Backup ----------
  async function gerarBackup(perfil, padroes, gastos, obterFoto) {
    const zip = new JSZip();
    const fotosMeta = [];
    for (const g of gastos) {
      for (const id of g.fotos || []) {
        const f = await obterFoto(id);
        if (!f) continue;
        zip.file(`fotos/${id}.jpg`, f.dados);
        fotosMeta.push({ id, w: f.w, h: f.h, tipo: f.tipo, thumb: f.thumb });
      }
    }
    zip.file('dados.json', JSON.stringify({ app: 'reembolso', versao: 1, criadoEm: new Date().toISOString(), perfil, padroes, gastos, fotos: fotosMeta }));
    return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
  }

  async function lerBackup(arquivo) {
    const zip = await JSZip.loadAsync(arquivo);
    const json = zip.file('dados.json');
    if (!json) throw new Error('Este arquivo não é um backup do app.');
    const dados = JSON.parse(await json.async('string'));
    if (dados.app !== 'reembolso' || !Array.isArray(dados.gastos)) throw new Error('Este arquivo não é um backup do app.');
    const fotos = [];
    for (const meta of dados.fotos || []) {
      const f = zip.file(`fotos/${meta.id}.jpg`);
      if (f) fotos.push({ id: meta.id, w: meta.w, h: meta.h, tipo: meta.tipo || 'image/jpeg', thumb: meta.thumb || '', dados: await f.async('arraybuffer') });
    }
    return { perfil: dados.perfil, padroes: dados.padroes, gastos: dados.gastos, fotos };
  }

  return { gerarPlanilha, gerarPDF, gerarBackup, lerBackup, montarLinhas, serialExcel };
})();
