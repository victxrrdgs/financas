// Exporta a planilha do Excel (.xlsx) formatada. Carregado só quando o usuário pede a planilha.
// Os números vêm dos mesmos cálculos do app (calc.js e planos.js).
import * as C from './calc.js?v=3.0.1';
import * as P from './planos.js?v=3.0.1';

const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const EXCELJS_SRI = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';

// Cores do app (styles.css), em ARGB.
const COR = {
  fundo: 'FF07080C', texto: 'FFF5F5F7', lime: 'FFC6F432', accent: 'FFFF7A45', linha: 'FFE5E7EB', zebra: 'FFF7F7FA',
  verde: 'FF15803D', vermelho: 'FFE11D48', ambar: 'FFB45309',
  fundoVerde: 'FFDCFCE7', fundoVermelho: 'FFFFE4E6', fundoAmbar: 'FFFEF3C7',
};
const FMT_RS = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const FMT_DATA = 'dd/mm/yyyy';
const FMT_PCT = '0%';

let carregando = null;
function carregarExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  carregando ||= new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = EXCELJS; s.integrity = EXCELJS_SRI; s.crossOrigin = 'anonymous';
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => { carregando = null; s.remove(); erro(new Error('Sem conexão para gerar a planilha. Tente de novo com internet.')); };
    document.head.append(s);
  });
  return carregando;
}

const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
// ExcelJS grava datas em UTC: monta a data em UTC para o dia não mudar.
const data = (iso) => { if (!iso) return null; const [a, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const argb = (hex) => 'FF' + String(hex || '#a1a1aa').replace('#', '').toUpperCase();
// Cor clara da categoria para o fundo da célula (mistura com branco).
function clara(hex, t = 0.28) {
  const h = String(hex || '#a1a1aa').replace('#', '');
  const c = [0, 2, 4].map((i) => Math.round(255 - (255 - parseInt(h.slice(i, i + 2), 16)) * t));
  return 'FF' + c.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
const fundo = (cor) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: cor } });
const borda = { bottom: { style: 'thin', color: { argb: COR.linha } } };

// Cria uma aba com título, cabeçalho escuro fixo e colunas no formato certo.
// cols: [{ t: título, w: largura mínima, f: 'rs' | 'data' | 'pct' | undefined }]
function aba(wb, nome, titulo, cols, cor = COR.lime) {
  const ws = wb.addWorksheet(nome, { properties: { tabColor: { argb: cor } }, views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
  ws.columns = cols.map((c) => ({ width: c.w || 12, style: c.f === 'rs' ? { numFmt: FMT_RS } : c.f === 'data' ? { numFmt: FMT_DATA } : c.f === 'pct' ? { numFmt: FMT_PCT } : {} }));
  ws.mergeCells(1, 1, 1, cols.length);
  const t = ws.getCell(1, 1);
  t.value = titulo; t.font = { bold: true, size: 15, color: { argb: COR.texto } }; t.fill = fundo(COR.fundo);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;
  cabecalho(ws, 3, cols.map((c) => c.t));
  ws._cols = cols;
  return ws;
}

function cabecalho(ws, n, titulos) {
  const r = ws.getRow(n);
  r.values = titulos; r.height = 22;
  titulos.forEach((_, i) => {
    const c = r.getCell(i + 1);
    c.font = { bold: true, color: { argb: COR.texto } }; c.fill = fundo(COR.fundo);
    c.alignment = { vertical: 'middle' };
    c.border = { bottom: { style: 'medium', color: { argb: COR.lime } } };
  });
}

// Adiciona linhas zebradas e devolve o número da primeira e da última.
function linhas(ws, dados, ini) {
  dados.forEach((v, k) => {
    const r = ws.getRow(ini + k);
    r.values = v;
    v.forEach((_, i) => {
      const c = r.getCell(i + 1);
      c.border = borda;
      if (k % 2) c.fill = fundo(COR.zebra);
    });
  });
  return [ini, ini + dados.length - 1];
}

function linhaTotal(ws, n, rotulo, somas, ini, fim) {
  const r = ws.getRow(n);
  r.getCell(1).value = rotulo;
  somas.forEach(([col, valor]) => {
    const L = ws.getColumn(col).letter;
    // SUBTOTAL(109) soma só as linhas visíveis quando o filtro está ativo.
    r.getCell(col).value = fim >= ini ? { formula: `SUBTOTAL(109,${L}${ini}:${L}${fim})`, result: valor } : 0;
  });
  for (let i = 1; i <= ws._cols.length; i++) {
    const c = r.getCell(i);
    c.font = { bold: true, color: { argb: COR.texto } }; c.fill = fundo(COR.fundo);
  }
}

// Ajusta a largura das colunas ao maior texto.
function ajustarLarguras(ws) {
  ws._cols.forEach((col, i) => {
    let max = String(col.t).length + 3; // espaço do botão do filtro
    ws.getColumn(i + 1).eachCell({ includeEmpty: false }, (c, n) => {
      if (n === 1 || c.isMerged) return; // título e linhas mescladas não contam
      const v = c.value;
      const s = v instanceof Date ? '00/00/0000' : typeof v === 'number' ? (col.f === 'rs' ? 'R$ ' + v.toFixed(2) + '000' : String(v)) : v && v.formula ? 'R$ 000.000,00' : String(v ?? '');
      max = Math.max(max, s.length);
    });
    ws.getColumn(i + 1).width = Math.min(60, Math.max(col.w || 8, max + 3));
  });
}

function pinta(c, cor, fundoCor) {
  c.font = { ...(c.font || {}), bold: true, color: { argb: cor } };
  if (fundoCor) c.fill = fundo(fundoCor);
}

export async function gerarPlanilha({ D, ym, nomeCarteira, usuario }) {
  const ExcelJS = await carregarExcelJS();
  C.configurar((D.config.find((x) => x.id === 'prefs')) || {});
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Minhas Finanças'; wb.created = new Date();
  const mes = C.rotuloMes(ym);
  const hoje = C.hojeISO();

  // ---------- 1. Resumo do mês ----------
  const r = C.resumoMes(D, ym);
  const ws1 = aba(wb, 'Resumo do mês', `Resumo de ${mes}${usuario ? ' · ' + usuario : ''}`, [{ t: 'Item', w: 30 }, { t: 'Valor', w: 16, f: 'rs' }, { t: '% do total', w: 12, f: 'pct' }], COR.lime);
  const res = [
    ['Entrou', r.entrou, null, COR.verde],
    ['Pago', r.pago, null, null],
    ['Falta pagar', r.aPagar, null, r.aPagar > 0 ? COR.ambar : null],
    ['Sobra (entrou − pago)', r.sobra, null, r.sobra >= 0 ? COR.verde : COR.vermelho],
    ['Previsão no fim do mês (entrou − tudo)', r.previsao, null, r.previsao >= 0 ? COR.verde : COR.vermelho],
  ];
  linhas(ws1, res.map((x) => x.slice(0, 2)), 4);
  res.forEach((x, k) => { if (x[3]) pinta(ws1.getCell(4 + k, 2), x[3]); });
  if (r.vencidas.length) {
    const c = ws1.getCell(4 + res.length, 1);
    c.value = `⚠ ${r.vencidas.length} ${r.vencidas.length === 1 ? 'conta vencida' : 'contas vencidas'} neste mês`;
    c.font = { bold: true, color: { argb: COR.vermelho } };
  }
  const cats = C.gastosPorCategoria(D, ym);
  const totCat = C.r2(cats.reduce((t, [, v]) => t + v, 0));
  const iniCat = 4 + res.length + 2;
  cabecalho(ws1, iniCat, ['Gastos por categoria', 'Valor', '% do total']);
  const [a1, b1] = linhas(ws1, cats.map(([k, v]) => [`${C.catInfo(k).e} ${k}`, v, totCat ? v / totCat : 0]), iniCat + 1);
  cats.forEach(([k], i) => { ws1.getCell(a1 + i, 1).fill = fundo(clara(C.catInfo(k).c)); });
  linhaTotal(ws1, b1 + 1, 'Total gasto', [[2, totCat]], a1, b1);
  ajustarLarguras(ws1);

  // ---------- 2. Lançamentos ----------
  const ws2 = aba(wb, 'Lançamentos', 'Lançamentos', [
    { t: 'Data', w: 12, f: 'data' }, { t: 'Tipo', w: 14 }, { t: 'Descrição', w: 30 }, { t: 'Categoria', w: 16 },
    { t: 'Valor', w: 14, f: 'rs' }, { t: 'Situação', w: 16 }, { t: 'Conta/Cartão', w: 14 }, { t: 'Parcelas', w: 10 },
  ], COR.accent);
  const L = [];
  C.vis(D.contas).forEach((c) => L.push([c.data, 'Conta a pagar', c.descricao, c.categoria || 'Outros', -C.r2(c.valor), c.pago ? `Paga em ${dataBR(c.pagoEm)}` : 'Em aberto', nomeCarteira(c.carteiraId), '']));
  C.vis(D.entradas).forEach((e) => L.push([e.data, 'Entrada', e.descricao, '', C.r2(e.valor), 'Recebida', nomeCarteira(e.carteiraId), '']));
  C.vis(D.compras).forEach((p) => L.push([p.data, p.recorrenteId ? 'Assinatura no cartão' : 'Compra no cartão', p.descricao, p.categoria || 'Outros', -C.r2(p.valor), '', nomeCarteira(p.carteiraId), p.parcelas > 1 ? `${p.parcelas}x` : 'À vista']));
  D.transferencias.forEach((t) => L.push([t.data, 'Transferência', `${nomeCarteira(t.de)} → ${nomeCarteira(t.para)}`, '', C.r2(t.valor), '', '', '']));
  C.parcelasComissao(D, { incluirCanceladas: true }).forEach((p) => L.push([
    p.data, 'Comissão', `${p.com.empresa}${p.com.produto ? ' — ' + p.com.produto : ''}`, '', C.r2(p.valor),
    p.com.cancelada ? 'Venda cancelada' : p.recebido ? `Recebida em ${dataBR(p.recebidoEm)}` : 'A receber', nomeCarteira(p.carteiraId), p.n > 1 ? `${p.i + 1}/${p.n}` : '',
  ]));
  L.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const [a2, b2] = linhas(ws2, L.map((l) => [data(l[0]), ...l.slice(1)]), 4);
  L.forEach((l, i) => {
    if (l[3]) { const c = ws2.getCell(a2 + i, 4); c.fill = fundo(clara(C.catInfo(l[3]).c)); }
    ws2.getCell(a2 + i, 5).font = { color: { argb: l[4] < 0 ? COR.vermelho : COR.verde } };
  });
  ws2.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, b2), column: 8 } };
  // Saídas são negativas e entradas positivas, então o total é o saldo dos lançamentos filtrados.
  linhaTotal(ws2, b2 + 1, 'Total', [[5, C.r2(L.reduce((t, l) => t + l[4], 0))]], a2, b2);
  ajustarLarguras(ws2);

  // ---------- 3. Cartões ----------
  const ws3 = aba(wb, 'Cartões', `Faturas com vencimento em ${mes}`, [
    { t: 'Cartão', w: 16 }, { t: 'Data da compra', w: 14, f: 'data' }, { t: 'Descrição', w: 30 }, { t: 'Categoria', w: 16 }, { t: 'Parcela', w: 9 }, { t: 'Valor', w: 14, f: 'rs' },
  ], '8B5CF6');
  const fats = C.cartoes(D).map((card) => C.faturaDe(D, card, ym));
  const itensF = []; const marca = [];
  fats.forEach((f) => {
    const sit = f.pago ? 'paga' : f.rolada ? 'vencida' : 'em aberto';
    marca.push({ k: itensF.length, f, sit });
    itensF.push([`${f.card.nome} · vence ${dataBR(f.data)} · ${sit}`, null, '', '', '', f.valor]);
    if (f.saldoAnterior) itensF.push([f.card.nome, null, `Saldo da fatura anterior (${C.nomeMes(f.mesAnterior, true)}) não paga`, '', '', f.saldoAnterior]);
    if (f.jurosEst) itensF.push([f.card.nome, null, 'Juros e encargos estimados', '', '', f.jurosEst]);
    f.itens.forEach((p) => itensF.push([f.card.nome, data(p.compra.data), p.compra.descricao, p.compra.categoria || 'Outros', p.n > 1 ? `${p.i}/${p.n}` : 'À vista', p.valor]));
  });
  const [a3, b3] = linhas(ws3, itensF, 4);
  itensF.forEach((l, i) => {
    if (l[3]) ws3.getCell(a3 + i, 4).fill = fundo(clara(C.catInfo(l[3]).c));
    ws3.getCell(a3 + i, 5).alignment = { horizontal: 'center' };
  });
  // Linha de cada cartão: destaque com a cor do cartão e o status da fatura.
  marca.forEach(({ k, f, sit }) => {
    const n = a3 + k;
    ws3.mergeCells(n, 1, n, 5);
    for (let i = 1; i <= 6; i++) {
      const c = ws3.getCell(n, i);
      c.font = { bold: true, color: { argb: COR.texto } }; c.fill = fundo(argb(f.card.cor || '#8b5cf6'));
    }
    const v = ws3.getCell(n, 6);
    v.fill = fundo(sit === 'paga' ? COR.fundoVerde : sit === 'vencida' ? COR.fundoVermelho : COR.fundoAmbar);
    v.font = { bold: true, color: { argb: sit === 'paga' ? COR.verde : sit === 'vencida' ? COR.vermelho : COR.ambar } };
  });
  if (!fats.length) ws3.getCell(4, 1).value = 'Nenhum cartão cadastrado.';
  else {
    // Aqui a soma é fixa: as linhas de cada cartão já trazem o total da fatura.
    linhaTotal(ws3, b3 + 1, 'Total das faturas', [], a3, b3);
    ws3.getCell(b3 + 1, 6).value = C.r2(fats.reduce((t, f) => t + f.valor, 0));
  }
  ajustarLarguras(ws3);

  // ---------- 4. Contas a pagar ----------
  const ws4 = aba(wb, 'Contas a pagar', `Contas a pagar · ${mes}`, [
    { t: 'Vencimento', w: 12, f: 'data' }, { t: 'Descrição', w: 30 }, { t: 'Categoria', w: 16 }, { t: 'Valor', w: 14, f: 'rs' }, { t: 'Status', w: 12 }, { t: 'Pago em', w: 12, f: 'data' }, { t: 'Conta', w: 14 },
  ], 'FB7185');
  const ids = new Set(r.itens.map((x) => x.id));
  // Contas vencidas de meses anteriores também aparecem, para nada ficar esquecido.
  const atrasadas = ym >= C.ymAtual() ? C.emAtraso(D).filter((x) => !ids.has(x.id) && x.data < C.periodo(ym)[0]) : [];
  const contas = [...atrasadas, ...r.itens].sort((a, b) => a.data.localeCompare(b.data));
  const status = (x) => (x.pago ? 'Paga' : x.data < hoje ? 'Vencida' : 'A vencer');
  const [a4, b4] = linhas(ws4, contas.map((x) => [data(x.data), x.descricao, x.categoria || 'Outros', x.valor, status(x), data(x.pagoEm), nomeCarteira(x.carteiraId)]), 4);
  contas.forEach((x, i) => {
    const s = status(x); const n = a4 + i;
    ws4.getCell(n, 3).fill = fundo(clara(C.catInfo(x.categoria || 'Outros').c));
    pinta(ws4.getCell(n, 5), s === 'Paga' ? COR.verde : s === 'Vencida' ? COR.vermelho : COR.ambar, s === 'Paga' ? COR.fundoVerde : s === 'Vencida' ? COR.fundoVermelho : COR.fundoAmbar);
    if (s === 'Vencida') [1, 2, 4].forEach((col) => { ws4.getCell(n, col).font = { bold: true, color: { argb: COR.vermelho } }; });
  });
  ws4.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, b4), column: 7 } };
  linhaTotal(ws4, b4 + 1, 'Total', [[4, C.soma(contas)]], a4, b4);
  ajustarLarguras(ws4);

  // ---------- 5. Financiamentos ----------
  const ws5 = aba(wb, 'Financiamentos', 'Financiamentos', [
    { t: 'Descrição', w: 24 }, { t: 'Parcela', w: 14, f: 'rs' }, { t: 'Dia', w: 6 }, { t: 'Pagas', w: 8 }, { t: 'Total', w: 8 }, { t: 'Restantes', w: 10 },
    { t: 'Saldo devedor', w: 16, f: 'rs' }, { t: 'Termina em', w: 14 }, { t: 'Juros a.m.', w: 10 }, { t: 'Concluído', w: 11, f: 'pct' },
  ], '60A5FA');
  const fins = D.recorrentes.filter((x) => x.financiamento).map((x) => ({ x, i: P.infoFinanciamento(D, x) }));
  const [a5, b5] = linhas(ws5, fins.map(({ x, i }) => [
    x.descricao, C.r2(x.valor), Number(x.dia) || null, i.pagas, i.total, i.restantes, i.saldo,
    x.fim ? C.rotuloMes(x.fim) : '', x.juros ? `${String(x.juros).replace('.', ',')}%` : '—', i.pct / 100,
  ]), 4);
  fins.forEach(({ i }, k) => { if (!i.restantes) pinta(ws5.getCell(a5 + k, 6), COR.verde, COR.fundoVerde); });
  ws5.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, b5), column: 10 } };
  if (!fins.length) ws5.getCell(4, 1).value = 'Nenhum financiamento cadastrado.';
  else linhaTotal(ws5, b5 + 1, 'Total', [[2, C.r2(fins.reduce((t, { x }) => t + Number(x.valor || 0), 0))], [7, C.r2(fins.reduce((t, { i }) => t + i.saldo, 0))]], a5, b5);
  ajustarLarguras(ws5);

  const buf = await wb.xlsx.writeBuffer();
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), lancamentos: L.length };
}
