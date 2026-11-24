// Dívidas, simulador de quitação, fluxo de caixa projetado, boletos e importação de extratos.
import * as C from './calc.js?v=3.0.2';

export const TAXA_CHEQUE = 8; // % ao mês, padrão quando a conta não tem taxa cadastrada
const pad = C.pad;
const addDias = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); const x = new Date(a, m - 1, d + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const difDias = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const mesesEntre = (a, b) => { const [y1, m1] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };

// ---------------- Financiamentos (recorrências com fim) ----------------
export function infoFinanciamento(D, r) {
  const hoje = C.ymAtual();
  const total = Number(r.totalParcelas) || 0;
  const pagasAntes = (Number(r.parcelaInicial) || 1) - 1;
  // Parcelas geradas pelo app e já pagas
  const pagasApp = C.vis(D.contas).filter((c) => c.recorrenteId === r.id && c.pago).length;
  const pagas = Math.min(total, pagasAntes + pagasApp);
  const restantes = Math.max(0, total - pagas);
  return { total, pagas, restantes, saldo: C.r2(restantes * Number(r.valor || 0)), termina: r.fim, pct: total ? Math.round((pagas / total) * 100) : 0, atual: hoje };
}

// ---------------- Dívidas ----------------
export function listaDividas(D) {
  const out = [];
  const hoje = C.hojeISO();
  C.emAtraso(D).forEach((x) => {
    if (x.tipo === 'fatura') out.push({ id: x.id, nome: x.descricao, tipo: 'Fatura em atraso', saldo: x.valor, taxa: C.taxaAtraso(x.card) || 15, parcela: null });
    else out.push({ id: x.id, nome: x.descricao, tipo: 'Conta vencida', saldo: x.valor, taxa: 1, parcela: null });
  });
  C.contasBancarias(D).forEach((b) => {
    const s = C.saldoCarteira(D, b);
    if (s < 0) out.push({ id: 'neg_' + b.id, nome: `${b.nome} · saldo negativo`, tipo: 'Cheque especial', saldo: -s, taxa: Number(b.jurosNegativo) || TAXA_CHEQUE, parcela: null });
  });
  // Parcelamentos de dívida no cartão (refinanciamento/renegociação): parcelas que ainda vão vencer
  C.cartoes(D).forEach((card) => {
    C.vis(D.compras).filter((cp) => cp.carteiraId === card.id && /refinanc|renegocia|parcelamento de fatura/i.test(cp.descricao)).forEach((cp) => {
      const fut = C.parcelasDe(cp, card).filter((p) => {
        const f = D.faturas.find((x) => x.id === `${card.id}_${p.ym}`);
        return !(f && f.pago) && C.diaNoMes(p.ym, card.vencimento) >= hoje;
      });
      if (fut.length) out.push({ id: 'cp_' + cp.id, nome: cp.descricao, tipo: `Parcelado no ${card.nome}`, saldo: C.soma(fut), taxa: 0, parcela: fut[0].valor, restantes: fut.length });
    });
  });
  D.recorrentes.filter((r) => r.financiamento).forEach((r) => {
    const i = infoFinanciamento(D, r);
    if (i.restantes > 0) out.push({ id: 'fin_' + r.id, nome: r.descricao, tipo: 'Financiamento', saldo: i.saldo, taxa: 0, parcela: Number(r.valor), restantes: i.restantes, juros: Number(r.juros) || 0 });
  });
  return out;
}

// Simula a quitação: juros mensais nas dívidas rotativas, parcelas fixas pagas todo mês,
// e o que sobrar do aporte vai para a dívida-alvo da estratégia.
export function simular(dividas, aporte, estrategia = 'avalanche') {
  const ds = dividas.map((d) => ({ ...d, s: d.saldo }));
  const minimo = C.r2(ds.reduce((t, d) => t + (d.parcela ? Math.min(d.parcela, d.s) : (d.s * d.taxa) / 100), 0));
  const quitacao = {}; let mes = 0; let juros = 0; let falta = 0;
  while (ds.some((d) => d.s > 0.005) && mes < 120) {
    mes++;
    ds.forEach((d) => { if (d.s > 0 && !d.parcela && d.taxa > 0) { const j = (d.s * d.taxa) / 100; d.s += j; juros += j; } });
    let caixa = aporte;
    ds.forEach((d) => { if (d.s > 0 && d.parcela) { const p = Math.min(d.parcela, d.s); d.s -= p; caixa -= p; } });
    if (caixa < 0) { falta = -caixa; break; }
    const rot = ds.filter((d) => d.s > 0.005 && !d.parcela).sort(estrategia === 'avalanche' ? (a, b) => b.taxa - a.taxa || a.s - b.s : (a, b) => a.s - b.s);
    const par = ds.filter((d) => d.s > 0.005 && d.parcela).sort((a, b) => a.s - b.s);
    for (const d of [...rot, ...par]) { if (caixa <= 0) break; const p = Math.min(caixa, d.s); d.s -= p; caixa -= p; }
    ds.forEach((d) => { if (d.s <= 0.005 && !quitacao[d.id]) quitacao[d.id] = mes; });
  }
  const viavel = !falta && !ds.some((d) => d.s > 0.005);
  return { viavel, meses: mes, juros: C.r2(juros), quitacao, minimo, falta: C.r2(falta), ordem: Object.entries(quitacao).sort((a, b) => a[1] - b[1]).map(([id]) => id) };
}

// ---------------- Fluxo de caixa ----------------
export function eventosFuturos(D, dias = 60, { comissoes = false } = {}) {
  const hoje = C.hojeISO(); const fim = addDias(hoje, dias); const ev = [];
  C.vis(D.contas).filter((c) => !c.pago).forEach((c) => { const d = c.data < hoje ? hoje : c.data; if (d <= fim) ev.push({ d, v: -c.valor, t: c.descricao, k: c.data < hoje ? 'vencida' : 'conta' }); });
  C.vis(D.entradas).filter((e) => e.data > hoje && e.data <= fim).forEach((e) => ev.push({ d: e.data, v: +e.valor, t: e.descricao, k: 'entrada' }));
  // Recorrências de meses ainda não gerados
  for (let k = 0; k <= Math.ceil(dias / 28) + 1; k++) {
    const m = C.somarMes(C.ymAtual(), k);
    D.recorrentes.forEach((r) => {
      if (r.tipo === 'compra' || !r.inicio || r.inicio > m || (r.fim && m > r.fim)) return;
      const col = r.tipo === 'entrada' ? D.entradas : D.contas;
      if (col.some((x) => x.id === `${r.id}_${m}`)) return;
      const d = C.dataNoPeriodo(m, r.dia);
      if (d > hoje && d <= fim) ev.push({ d, v: r.tipo === 'entrada' ? +r.valor : -r.valor, t: r.descricao, k: r.tipo === 'entrada' ? 'entrada' : 'conta' });
    });
  }
  // Faturas a vencer (as atrasadas já estão somadas na seguinte)
  C.cartoes(D).forEach((card) => {
    for (let k = 0; k <= 3; k++) {
      const f = C.faturaDe(D, card, C.somarMes(C.ymAtual(), k));
      // Assinaturas futuras ainda não lançadas entram na estimativa da fatura
      const extra = D.recorrentes.filter((r) => r.tipo === 'compra' && r.carteiraId === card.id && (!r.fim || r.fim >= f.ym))
        .filter((r) => { const md = C.somarMes(f.ym, -1); return r.inicio <= md && !D.compras.some((x) => x.id === `${r.id}_${md}`) && C.mesFatura(card, C.dataNoPeriodo(md, r.dia)) === f.ym; })
        .reduce((t, r) => t + Number(r.valor || 0), 0);
      const v = C.r2(f.valor + extra);
      if (!f.pago && v > 0 && f.data >= hoje && f.data <= fim) ev.push({ d: f.data, v: -v, t: f.descricao, k: 'fatura' });
    }
  });
  if (comissoes) C.parcelasComissao(D).filter((p) => !p.recebido && p.data >= hoje && p.data <= fim).forEach((p) => ev.push({ d: p.data, v: +p.valor, t: `Comissão · ${p.com.empresa}`, k: 'entrada' }));
  return ev.sort((a, b) => a.d.localeCompare(b.d) || b.v - a.v);
}

export function projecao(D, dias = 60, opts = {}) {
  const hoje = C.hojeISO();
  const saldo0 = C.saldoTotal(D);
  const ev = eventosFuturos(D, dias, opts);
  const serie = []; let s = saldo0; let i = 0;
  for (let n = 0; n <= dias; n++) {
    const d = addDias(hoje, n);
    while (i < ev.length && ev[i].d === d) { s += ev[i].v; ev[i].saldo = C.r2(s); i++; }
    serie.push({ d, s: C.r2(s) });
  }
  const min = serie.reduce((m, x) => (x.s < m.s ? x : m), serie[0]);
  const prox = ev.find((e) => e.v > 0);
  const limite = prox ? prox.d : addDias(hoje, 30);
  const janela = Math.max(1, difDias(hoje, limite));
  const ateLimite = saldo0 + ev.filter((e) => e.d < limite).reduce((t, e) => t + e.v, 0);
  return { saldo0, ev, serie, min, prox, janela, podeGastar: Math.max(0, C.r2(ateLimite / janela)), saldoAntesDaEntrada: C.r2(ateLimite) };
}

// ---------------- Boletos ----------------
// Aceita linha digitável (47 bancário / 48 convênio) ou código de barras (44).
export function lerBoleto(txt) {
  const n = String(txt || '').replace(/\D/g, '');
  // Fator de vencimento: reiniciou em 1000 no dia 22/02/2025. Fatores que dariam datas muito no futuro são do ciclo antigo (base 07/10/1997).
  const baseFator = (f) => {
    if (!f) return null;
    let x = new Date(2025, 1, 22 + (f - 1000));
    const limite = new Date(); limite.setFullYear(limite.getFullYear() + 3);
    if (x > limite) x = new Date(1997, 9, 7 + f);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  if (n.length === 47) return { tipo: 'bancario', codigo: n, valor: Number(n.slice(37)) / 100, vencimento: baseFator(Number(n.slice(33, 37))) };
  if (n.length === 44 && n[0] !== '8') return { tipo: 'bancario', codigo: n, valor: Number(n.slice(9, 19)) / 100, vencimento: baseFator(Number(n.slice(5, 9))) };
  if (n.length === 48 || (n.length === 44 && n[0] === '8')) {
    const barra = n.length === 48 ? [0, 12, 24, 36].map((i) => n.slice(i, i + 11)).join('') : n;
    const real = ['6', '7'].includes(barra[2]) || ['8', '9'].includes(barra[2]);
    return { tipo: 'convenio', codigo: n, valor: real ? Number(barra.slice(4, 15)) / 100 : null, vencimento: null };
  }
  return null;
}

// ---------------- Categorização e importação ----------------
const REGRAS = [
  [/uber|99 ?(pop|app|taxi)|cabify|posto|shell|ipiranga|combust|estaciona|pedagio|pedágio|autopista|sem parar|metro|metrô|bilhete|recarga top/i, 'Transporte'],
  [/ifood|99 ?food|rappi|restaurante|lanchonete|burger|mc ?donald|pizza|padaria|cafe|café|bar |sushi|outback|madero|starbucks/i, 'Restaurantes'],
  [/mercado|supermerc|carrefour|assai|assaí|atacad|extra |pão de açúcar|pao de acucar|hortifruti|coop|dia %|sacolão|açougue/i, 'Alimentação'],
  [/netflix|spotify|youtube|disney|hbo|max |prime video|amazon prime|deezer|apple\.com|google one|icloud|claude|chatgpt|openai|duolingo|meli\+|globoplay|paramount|crunchyroll/i, 'Assinaturas'],
  [/farm|drogaria|droga|raia|pacheco|panvel|hospital|clinic|clínic|laborat|consulta|odonto|unimed|amil|hapvida|petlove/i, 'Saúde'],
  [/aluguel|condom|iptu|imobili|leroy|telhanorte|casa |c&c|tok ?stok|super casa/i, 'Moradia'],
  [/vivo|claro|tim |oi |enel|sabesp|light|cemig|copel|eletropaulo|comgas|comgás|net |internet/i, 'Água/Luz/Internet'],
  [/escola|faculdade|curso|udemy|alura|livraria|saraiva/i, 'Educação'],
  [/cinema|ingresso|steam|playstation|xbox|nintendo|show|teatro|airbnb|booking|hotel|decolar/i, 'Lazer'],
  [/amazon|mercadolivre|mercado livre|shopee|aliexpress|magalu|magazine|americanas|riachuelo|renner|c&a|zara|centauro|netshoes|shein/i, 'Compras'],
  [/juros|multa|iof|encargo|anuidade|tarifa|renegocia|refinanc/i, 'Cartão de crédito'],
];
export function categorizar(desc, historico = []) {
  const h = historico.find((x) => x.descricao && x.descricao.toLowerCase() === String(desc).toLowerCase());
  if (h && h.categoria) return h.categoria;
  for (const [rx, cat] of REGRAS) if (rx.test(desc)) return cat;
  return 'Outros';
}

const valorBR = (s) => { const t = String(s).replace(/\s/g, '').replace(/R\$/i, ''); const neg = /^-|\(.*\)$/.test(t); const v = C.parseValor(t.replace(/[-()]/g, '')); return isFinite(v) ? (neg ? -v : v) : NaN; };
const dataISO = (s) => { s = String(s).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`; m = s.match(/^(\d{4})(\d{2})(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; return null; };

function lerCSV(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ';' : ',';
  const split = (l) => { const out = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const cab = split(linhas[0]).map((h) => h.toLowerCase());
  const iData = cab.findIndex((h) => /data|date/.test(h)); const iDesc = cab.findIndex((h) => /descri|title|hist|estabelec|lança|memo/.test(h)); const iVal = cab.findIndex((h) => /valor|amount|quantia/.test(h));
  if (iData < 0 || iVal < 0) return [];
  return linhas.slice(1).map(split).map((c) => ({ data: dataISO(c[iData]), descricao: (c[iDesc >= 0 ? iDesc : 1] || '').trim(), valor: valorBR(c[iVal]) })).filter((x) => x.data && isFinite(x.valor));
}
function lerOFX(texto) {
  return [...texto.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)].map((m) => {
    const tag = (t) => (m[1].match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i')) || [])[1];
    return { data: dataISO(tag('DTPOSTED') || ''), descricao: (tag('MEMO') || tag('NAME') || '').trim(), valor: Number(String(tag('TRNAMT') || '').replace(',', '.')) };
  }).filter((x) => x.data && isFinite(x.valor));
}

// Converte o arquivo em lançamentos sugeridos. Em cartão, positivo = gasto; em conta, negativo = gasto.
export function analisarExtrato(texto, nome, destino, D) {
  const ofx = /<OFX>|<STMTTRN>/i.test(texto) || /\.ofx$/i.test(nome);
  let itens = ofx ? lerOFX(texto) : lerCSV(texto);
  const cartao = destino.tipo === 'cartao';
  if (ofx && cartao) itens = itens.map((x) => ({ ...x, valor: -x.valor }));
  const hist = [...C.vis(D.compras), ...C.vis(D.contas)].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return itens.map((x, i) => {
    const gasto = cartao ? x.valor > 0 : x.valor < 0;
    const v = Math.abs(x.valor);
    const pag = /pagamento|pgto|payment|estorno|crédito por|credito por|desconto/i.test(x.descricao);
    const parc = x.descricao.match(/parcela\s*(\d+)\s*(?:\/|de)\s*(\d+)/i) || x.descricao.match(/\s(\d{1,2})\/(\d{1,2})\s*$/);
    const pAtual = parc ? Number(parc[1]) : 1; const pTotal = parc ? Number(parc[2]) : 1;
    const limpa = x.descricao.replace(/\s*-?\s*parcela\s*\d+\s*(\/|de)\s*\d+/i, '').replace(/^(pg|pag)\s*\*\s*/i, '').replace(/\s+/g, ' ').trim();
    const bonito = limpa.toLowerCase().replace(/(^|\s)\S/g, (s) => s.toUpperCase());
    const dup = (cartao ? D.compras : [...D.contas, ...D.entradas]).some((y) => !y.excluida && y.carteiraId === destino.id && Math.abs(Number(y.valor) - (pTotal > 1 ? v * (pTotal - pAtual + 1) : v)) < 0.02 && Math.abs(difDias(y.data, x.data)) <= 3);
    return {
      i, data: x.data, original: x.descricao, descricao: pTotal > 1 ? `${bonito} (parcelas ${pAtual} a ${pTotal} de ${pTotal})` : bonito,
      valor: v, gasto, restantes: pTotal - pAtual + 1, categoria: categorizar(limpa, hist), duplicado: dup, ignorar: (cartao && !gasto) || pag,
    };
  });
}
