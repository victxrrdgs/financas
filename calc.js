// Regras de negócio e cálculos (sem interface).

export const CATS = {
  'Moradia': { e: '🏠', c: '#ff8a4c' },
  'Alimentação': { e: '🛒', c: '#4ade80' },
  'Restaurantes': { e: '🍔', c: '#facc15' },
  'Transporte': { e: '🚗', c: '#60a5fa' },
  'Saúde': { e: '💊', c: '#f87171' },
  'Educação': { e: '📚', c: '#c084fc' },
  'Lazer': { e: '🎮', c: '#f472b6' },
  'Compras': { e: '🛍️', c: '#2dd4bf' },
  'Assinaturas': { e: '📺', c: '#818cf8' },
  'Água/Luz/Internet': { e: '💡', c: '#22d3ee' },
  'Impostos': { e: '🧾', c: '#94a3b8' },
  'Cartão de crédito': { e: '💳', c: '#a78bfa' },
  'Outros': { e: '📦', c: '#a1a1aa' },
};
// Preferências do usuário que afetam os cálculos (definidas por configurar()).
let INICIO = 1;
let EXTRAS = {};
export function configurar(p = {}) {
  INICIO = Math.min(28, Math.max(1, Number(p.diaInicio) || 1));
  EXTRAS = {};
  (p.categorias || []).forEach((c) => { if (c && c.nome) EXTRAS[c.nome] = { e: c.e || '🏷️', c: c.c || '#a1a1aa', custom: true }; });
}
export const diaInicio = () => INICIO;
export const catInfo = (k) => EXTRAS[k] || CATS[k] || CATS.Outros;
export const listaCategorias = () => [...Object.keys(CATS).filter((k) => k !== 'Cartão de crédito' && k !== 'Outros'), ...Object.keys(EXTRAS), 'Outros'];
export const CORES = ['#ff6b35', '#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#64748b'];

export const pad = (n) => String(n).padStart(2, '0');
export const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Mês financeiro de uma data: com início no dia 5, 03/12 pertence a novembro.
export function mesDe(iso) {
  if (!iso) return '';
  const m = iso.slice(0, 7);
  return Number(iso.slice(8, 10)) >= INICIO ? m : somarMes(m, -1);
}
export const noMes = (iso, ym) => mesDe(iso) === ym;
export const ymAtual = () => mesDe(hojeISO());
export function periodo(ym) {
  const ini = diaNoMes(ym, INICIO);
  if (INICIO === 1) return [ini, diaNoMes(ym, 31)];
  const [a, m, d] = diaNoMes(somarMes(ym, 1), INICIO).split('-').map(Number);
  return [ini, isoDe(new Date(a, m - 1, d - 1))];
}
export function diasDoPeriodo(ym) {
  const [ini, fim] = periodo(ym);
  const out = [];
  const [a, m, d] = ini.split('-').map(Number);
  for (let x = new Date(a, m - 1, d); isoDe(x) <= fim; x.setDate(x.getDate() + 1)) out.push(isoDe(x));
  return out;
}
// Data, dentro do mês financeiro `ym`, de algo que acontece todo dia `dia`.
export const dataNoPeriodo = (ym, dia) => (Number(dia) >= INICIO ? diaNoMes(ym, dia) : diaNoMes(somarMes(ym, 1), dia));
export const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const soma = (arr) => r2(arr.reduce((s, x) => s + (Number(x.valor) || 0), 0));
export const vis = (l) => l.filter((x) => !x.excluida);
export const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
export const slug = (s) => String(s).normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase();

export function somarMes(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function diaNoMes(ym, dia) {
  const [a, m] = ym.split('-').map(Number);
  return `${ym}-${pad(Math.min(Number(dia) || 1, new Date(a, m, 0).getDate()))}`;
}
export function nomeMes(ym, curto = false) {
  const [a, m] = ym.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: curto ? 'short' : 'long' }).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function rotuloMes(ym) {
  return `${nomeMes(ym)} ${ym.slice(0, 4)}`;
}
export function diasAte(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const [ha, hm, hd] = hojeISO().split('-').map(Number);
  return Math.round((new Date(a, m - 1, d) - new Date(ha, hm - 1, hd)) / 86400000);
}
export function parseValor(txt) {
  let s = String(txt ?? '').trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = r2(parseFloat(s));
  return isFinite(v) && s !== '' ? v : NaN;
}

// ---------------- Cartão de crédito ----------------
export const cartoes = (D) => D.carteiras.filter((c) => c.tipo === 'cartao');
export const contasBancarias = (D) => D.carteiras.filter((c) => c.tipo !== 'cartao');

// Mês (de vencimento) da fatura em que cai uma compra feita em `data`.
export function mesFatura(card, data) {
  const fech = Number(card.fechamento) || 1;
  const venc = Number(card.vencimento) || 10;
  let m = data.slice(0, 7);
  if (Number(data.slice(8, 10)) >= fech) m = somarMes(m, 1);
  if (venc <= fech) m = somarMes(m, 1);
  return m;
}

export function parcelasDe(compra, card) {
  const n = Math.max(1, Number(compra.parcelas) || 1);
  const totalC = Math.round(Number(compra.valor) * 100);
  const base = Math.floor(totalC / n);
  const resto = totalC - base * n;
  const m0 = mesFatura(card, compra.data);
  return Array.from({ length: n }, (_, i) => ({ ym: somarMes(m0, i), i: i + 1, n, valor: (base + (i === 0 ? resto : 0)) / 100 }));
}

export function faturaDe(D, card, ym) {
  const itens = [];
  vis(D.compras).filter((x) => x.carteiraId === card.id).forEach((cp) => {
    parcelasDe(cp, card).filter((p) => p.ym === ym).forEach((p) => itens.push({ ...p, compra: cp }));
  });
  itens.sort((a, b) => b.compra.data.localeCompare(a.compra.data));
  const id = `${card.id}_${ym}`;
  const doc = D.faturas.find((f) => f.id === id) || {};
  return {
    tipo: 'fatura', id, card, ym, itens, valor: soma(itens),
    data: diaNoMes(ym, card.vencimento), fecha: diaNoMes(somarMes(ym, Number(card.vencimento) <= Number(card.fechamento) ? -1 : 0), card.fechamento),
    pago: !!doc.pago, pagoEm: doc.pagoEm || null, carteiraId: doc.carteiraId || null, valorPago: doc.valor || 0,
    descricao: `Fatura ${card.nome}`, categoria: 'Cartão de crédito',
  };
}
export const faturasMes = (D, ym) => cartoes(D).map((c) => faturaDe(D, c, ym));

export function limiteUsado(D, card) {
  let usado = 0;
  vis(D.compras).filter((x) => x.carteiraId === card.id).forEach((cp) => {
    parcelasDe(cp, card).forEach((p) => {
      const f = D.faturas.find((x) => x.id === `${card.id}_${p.ym}`);
      if (!f || !f.pago) usado += p.valor;
    });
  });
  return r2(usado);
}

// ---------------- Carteiras ----------------
export function saldoCarteira(D, cart) {
  if (cart.tipo === 'cartao') return -limiteUsado(D, cart);
  const h = hojeISO();
  let s = Number(cart.saldoInicial) || 0;
  s += soma(vis(D.entradas).filter((e) => e.carteiraId === cart.id && e.data <= h));
  s -= soma(vis(D.contas).filter((c) => c.pago && c.carteiraId === cart.id));
  s -= D.faturas.filter((f) => f.pago && f.carteiraId === cart.id).reduce((t, f) => t + (Number(f.valor) || 0), 0);
  D.transferencias.filter((t) => t.data <= h).forEach((t) => {
    if (t.para === cart.id) s += Number(t.valor) || 0;
    if (t.de === cart.id) s -= Number(t.valor) || 0;
  });
  return r2(s);
}
export const saldoTotal = (D) => r2(contasBancarias(D).reduce((t, c) => t + saldoCarteira(D, c), 0));

// ---------------- Resumo do mês ----------------
export function pagaveisMes(D, ym) {
  const contas = vis(D.contas).filter((c) => noMes(c.data, ym)).map((c) => ({ ...c, tipo: 'conta' }));
  // A fatura entra no mês financeiro do seu vencimento.
  const fats = [-1, 0, 1].flatMap((k) => faturasMes(D, somarMes(ym, k)))
    .filter((f) => noMes(f.data, ym) && (f.valor > 0 || f.pago));
  return [...contas, ...fats];
}

export function resumoMes(D, ym) {
  const itens = pagaveisMes(D, ym);
  const entradas = vis(D.entradas).filter((e) => noMes(e.data, ym));
  const pagos = itens.filter((x) => x.pago);
  const abertos = itens.filter((x) => !x.pago);
  const entrou = soma(entradas);
  const pago = soma(pagos);
  const aPagar = soma(abertos);
  const total = r2(pago + aPagar);
  const vencidas = abertos.filter((x) => diasAte(x.data) < 0);
  return {
    itens, entradas, pagos, abertos, vencidas, entrou, pago, aPagar, total,
    sobra: r2(entrou - pago), previsao: r2(entrou - total),
    pct: total > 0 ? Math.round((pago / total) * 100) : 0,
  };
}

export function gastosPorCategoria(D, ym) {
  const m = {};
  const add = (k, v) => { k = k || 'Outros'; m[k] = r2((m[k] || 0) + (Number(v) || 0)); };
  vis(D.contas).filter((c) => noMes(c.data, ym)).forEach((c) => add(c.categoria, c.valor));
  cartoes(D).forEach((card) => {
    vis(D.compras).filter((x) => x.carteiraId === card.id).forEach((cp) => {
      parcelasDe(cp, card).filter((p) => noMes(diaNoMes(p.ym, card.vencimento), ym)).forEach((p) => add(cp.categoria, p.valor));
    });
  });
  return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

// Gastos efetivos por data (ISO): contas pagas (pela data do pagamento) e compras no cartão (pela data da compra).
export function gastosPorDia(D, ym) {
  const m = {};
  const add = (iso, v) => { if (iso && noMes(iso, ym)) m[iso] = r2((m[iso] || 0) + Number(v || 0)); };
  vis(D.contas).filter((c) => c.pago).forEach((c) => add(c.pagoEm, c.valor));
  vis(D.compras).forEach((cp) => add(cp.data, cp.valor));
  return m;
}

export function serieMeses(D, ym, n = 6) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const m = somarMes(ym, -k);
    const r = resumoMes(D, m);
    out.push({ ym: m, entrou: r.entrou, saiu: r.total });
  }
  return out;
}

export function orcamentosMes(D, ym) {
  const g = Object.fromEntries(gastosPorCategoria(D, ym));
  return D.orcamentos
    .map((o) => ({ ...o, gasto: g[o.categoria] || 0, pct: o.limite > 0 ? Math.round(((g[o.categoria] || 0) / o.limite) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);
}

// ---------------- Comissões ----------------
// Uma venda gera a comissão em 1 ou mais parcelas: cada parcela é recebida no mês em que o cliente paga.
export function dividir(total, n) {
  const c = Math.round(Number(total) * 100);
  const base = Math.floor(c / n);
  const resto = c - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i === 0 ? resto : 0)) / 100);
}

export function parcelasComissao(D, { incluirCanceladas = false } = {}) {
  const out = [];
  (D.comissoes || []).forEach((com) => {
    if (com.cancelada && !incluirCanceladas) return;
    const ps = com.parcelas || [];
    ps.forEach((p, i) => out.push({ com, i, n: ps.length, ...p }));
  });
  return out;
}

export function resumoComissoes(D, ym) {
  const ps = parcelasComissao(D);
  const pend = ps.filter((p) => !p.recebido);
  const vendas = (D.comissoes || []).filter((c) => !c.cancelada && noMes(c.dataVenda, ym));
  return {
    pendentes: pend,
    aReceber: soma(pend),
    previstoMes: soma(pend.filter((p) => noMes(p.data, ym))),
    atrasadas: pend.filter((p) => diasAte(p.data) < 0),
    recebidasMes: ps.filter((p) => p.recebido && noMes(p.recebidoEm, ym)),
    recebidoMes: soma(ps.filter((p) => p.recebido && noMes(p.recebidoEm, ym))),
    vendasMes: vendas,
    vendidoMes: r2(vendas.reduce((t, c) => t + (Number(c.valorVenda) || 0), 0)),
    geradoMes: r2(vendas.reduce((t, c) => t + (c.parcelas || []).reduce((s, p) => s + (Number(p.valor) || 0), 0), 0)),
  };
}

export function serieComissoes(D, ym, n = 6) {
  const ps = parcelasComissao(D).filter((p) => p.recebido);
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const m = somarMes(ym, -k);
    out.push({ ym: m, valor: soma(ps.filter((p) => noMes(p.recebidoEm, m))) });
  }
  return out;
}

export function rankingComissoes(D, campo) {
  const m = {};
  (D.comissoes || []).filter((c) => !c.cancelada).forEach((c) => {
    const k = (c[campo] || '—').trim() || '—';
    const v = (c.parcelas || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
    m[k] = r2((m[k] || 0) + v);
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

export function insights(D, ym, fmt, opts = {}) {
  const out = [];
  const r = resumoMes(D, ym);
  if (opts.comissoes) {
    const rc = resumoComissoes(D, ym);
    if (rc.atrasadas.length) out.push({ e: '💼', t: `${rc.atrasadas.length} ${rc.atrasadas.length === 1 ? 'comissão atrasada' : 'comissões atrasadas'} (${fmt(soma(rc.atrasadas))}). Vale cobrar o cliente`, tipo: 'amber' });
    if (rc.previstoMes > 0) out.push({ e: '💼', t: `${fmt(rc.previstoMes)} em comissões previstas para ${nomeMes(ym).toLowerCase()}`, tipo: 'green' });
  }
  const plural = (n, s, p) => (n === 1 ? s : p);
  if (r.vencidas.length) out.push({ e: '⚠️', t: `${r.vencidas.length} ${plural(r.vencidas.length, 'conta vencida', 'contas vencidas')} somando ${fmt(soma(r.vencidas))}`, tipo: 'red' });
  const semana = r.abertos.filter((x) => { const d = diasAte(x.data); return d >= 0 && d <= 7; });
  if (semana.length) out.push({ e: '📅', t: `${semana.length} ${plural(semana.length, 'conta vence', 'contas vencem')} nos próximos 7 dias (${fmt(soma(semana))})`, tipo: 'amber' });
  if (r.previsao < 0) out.push({ e: '📉', t: `Pagando tudo, o mês fecha ${fmt(Math.abs(r.previsao))} no negativo`, tipo: 'red' });

  orcamentosMes(D, ym).forEach((o) => {
    if (o.pct >= 100) out.push({ e: '🚨', t: `Orçamento de ${o.categoria} estourado: ${fmt(o.gasto)} de ${fmt(o.limite)}`, tipo: 'red' });
    else if (o.pct >= 80) out.push({ e: '🟡', t: `Você já usou ${o.pct}% do orçamento de ${o.categoria}`, tipo: 'amber' });
  });

  const atual = Object.fromEntries(gastosPorCategoria(D, ym));
  const ant = Object.fromEntries(gastosPorCategoria(D, somarMes(ym, -1)));
  let maiorAlta = null; let maiorQueda = null;
  for (const k of new Set([...Object.keys(atual), ...Object.keys(ant)])) {
    const a = atual[k] || 0; const b = ant[k] || 0;
    if (b > 0 && a > b * 1.15 && a - b >= 50 && (!maiorAlta || a - b > maiorAlta.d)) maiorAlta = { k, d: a - b, p: Math.round(((a - b) / b) * 100) };
    if (b > 0 && a < b * 0.85 && b - a >= 50 && (!maiorQueda || b - a > maiorQueda.d)) maiorQueda = { k, d: b - a, p: Math.round(((b - a) / b) * 100) };
  }
  const mesAnt = nomeMes(somarMes(ym, -1)).toLowerCase();
  if (maiorAlta) out.push({ e: '📈', t: `${maiorAlta.p}% a mais com ${maiorAlta.k} que em ${mesAnt}`, tipo: 'amber' });
  if (maiorQueda) out.push({ e: '👏', t: `${maiorQueda.p}% a menos com ${maiorQueda.k} que em ${mesAnt}`, tipo: 'green' });

  if (r.sobra > 0 && D.metas.length && ym === ymAtual()) out.push({ e: '🎯', t: `Sobraram ${fmt(r.sobra)} até agora. Que tal guardar parte numa meta?`, tipo: 'green' });
  if (!out.length) out.push({ e: '✨', t: 'Tudo em dia por aqui', tipo: 'green' });
  return out;
}
