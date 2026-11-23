import { criarStore, modoLocal, COLECOES } from './store.js';
import * as C from './calc.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

// ---------------- Estado ----------------
let store;
let usuario = null;
let ym = C.ymAtual();
let tela = 'inicio';
let sub = 'apagar';
let ocultar = localStorage.getItem('fin-ocultar') === '1';
const D = Object.fromEntries(COLECOES.map((c) => [c, []]));
const srv = {};
let paradas = [];
const geradosNestaSessao = new Set();
let ultimoHero = null;

const fmt = (v) => (ocultar ? 'R$ ••••' : brl.format(Number(v) || 0));
const fmtCurto = (v) => (ocultar ? '••' : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v || 0));

const ICON_OLHO = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_OLHO_OFF = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2400);
}

const carteira = (id) => D.carteiras.find((c) => c.id === id);
function carteiraPadrao() {
  const bancos = C.contasBancarias(D);
  const ult = localStorage.getItem('fin-ultima-carteira');
  return (bancos.find((b) => b.id === ult) || bancos[0] || {}).id || null;
}

// ---------------- Inicialização ----------------
async function iniciar() {
  store = await criarStore();
  $('#btn-login').addEventListener('click', async () => {
    $('#login-erro').textContent = '';
    try { await store.entrar(); } catch (e) { $('#login-erro').textContent = 'Não foi possível entrar: ' + (e.code || e.message); }
  });
  if (modoLocal) $('#btn-login').textContent = 'Entrar (modo local de teste)';
  ligarEventos();
  atualizarOlho();
  await store.init((u) => { usuario = u; u ? mostrarApp() : mostrarLogin(); });
  store.assinarStatus((s) => { $('#sync-status').textContent = s; });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function mostrarLogin() {
  paradas.forEach((f) => f()); paradas = [];
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

function mostrarApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const nome = usuario.displayName || '';
  $('#avatar').innerHTML = usuario.photoURL ? `<img src="${esc(usuario.photoURL)}" alt="" referrerpolicy="no-referrer">` : esc((nome[0] || '?').toUpperCase());
  $('#menu-user').innerHTML = `<b>${esc(nome)}</b><br>${esc(usuario.email || '')}`;
  paradas.forEach((f) => f());
  paradas = COLECOES.map((col) => store.assinar(col, (lista, doServidor) => {
    D[col] = lista; srv[col] = doServidor;
    gerarRecorrentes();
    agendarRender();
  }));
  agendarRender();
}

let renderPendente = false;
function agendarRender() {
  if (renderPendente) return;
  renderPendente = true;
  requestAnimationFrame(() => { renderPendente = false; render(); });
}

// Cria os lançamentos das recorrências para o mês aberto e o atual.
// Só roda com dados confirmados pelo servidor, para não duplicar nem sobrescrever.
function gerarRecorrentes() {
  if (!srv.contas || !srv.entradas || !srv.recorrentes) return;
  for (const mes of new Set([ym, C.ymAtual()])) {
    for (const r of D.recorrentes) {
      if (!r.inicio || r.inicio > mes || (r.fim && mes > r.fim)) continue;
      const id = `${r.id}_${mes}`;
      const col = r.tipo === 'entrada' ? 'entradas' : 'contas';
      if (D[col].some((x) => x.id === id) || geradosNestaSessao.has(id)) continue;
      geradosNestaSessao.add(id);
      const doc = { descricao: r.descricao, valor: r.valor, data: C.diaNoMes(mes, r.dia), recorrenteId: r.id, carteiraId: r.carteiraId || null };
      if (col === 'contas') Object.assign(doc, { categoria: r.categoria || 'Outros', pago: false, pagoEm: null });
      store.definir(col, id, doc);
    }
  }
}

// ---------------- Render ----------------
function render() {
  $('#mes-label').textContent = C.rotuloMes(ym);
  $$('.dock [data-tela]').forEach((b) => b.classList.toggle('active', b.dataset.tela === tela));
  const el = $('#conteudo');
  const html = { inicio: telaInicio, lanc: telaLanc, planejar: telaPlanejar, relatorios: telaRelatorios }[tela]();
  el.innerHTML = html;
  animarHero();
}

function trocarTela(t) {
  tela = t;
  render();
  $('#conteudo').classList.remove('fade-in'); void $('#conteudo').offsetWidth; $('#conteudo').classList.add('fade-in');
  window.scrollTo({ top: 0 });
}

function animarHero() {
  const el = $('.hero-val');
  if (!el) return;
  const alvo = Number(el.dataset.count);
  const de = ultimoHero ?? 0;
  ultimoHero = alvo;
  if (ocultar || de === alvo || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const passo = (t) => {
    const p = Math.min(1, (t - t0) / 700);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(de + (alvo - de) * e);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function tagVenc(x) {
  if (x.pago) return `<span class="tag green">Pago ${x.pagoEm ? 'em ' + C.dataBR(x.pagoEm) : ''}</span>`;
  const d = C.diasAte(x.data);
  if (d < 0) return `<span class="tag red">Venceu há ${plural(-d, 'dia', 'dias')}</span>`;
  if (d === 0) return '<span class="tag amber">Vence hoje</span>';
  if (d <= 3) return `<span class="tag amber">Vence em ${plural(d, 'dia', 'dias')}</span>`;
  return '';
}

function linhaPagavel(x) {
  const fat = x.tipo === 'fatura';
  const ci = fat ? { e: '💳', c: x.card.cor || '#8b5cf6' } : C.catInfo(x.categoria);
  const cart = !fat && x.carteiraId ? carteira(x.carteiraId) : null;
  return `<div class="row">
    <div class="ic" style="--c:${ci.c}">${ci.e}</div>
    <div class="info" data-a="${fat ? 'ver-fatura' : 'editar-conta'}" data-id="${fat ? x.card.id : x.id}">
      <div class="t">${esc(x.descricao)}</div>
      <div class="m">${C.dataBR(x.data)}${fat ? ` · ${plural(x.itens.length, 'compra', 'compras')}` : ''}${x.recorrenteId ? ' · 🔁' : ''}${cart ? ' · ' + esc(cart.nome) : ''} ${tagVenc(x)}</div>
    </div>
    <div class="v">${fmt(x.valor)}</div>
    <button class="chk ${x.pago ? 'on' : ''}" data-a="pagar" data-tipo="${x.tipo}" data-id="${x.id}" aria-label="${x.pago ? 'Desmarcar pagamento' : 'Marcar como pago'}">✓</button>
  </div>`;
}

function heatmap() {
  const dias = C.gastosPorDia(D, ym);
  const [a, m] = ym.split('-').map(Number);
  const total = new Date(a, m, 0).getDate();
  const offset = new Date(a, m - 1, 1).getDay();
  const vals = Object.values(dias).filter((v) => v > 0).sort((x, y) => x - y);
  const q = (p) => vals[Math.floor((vals.length - 1) * p)] || 0;
  const nivel = (v) => (!v ? '' : v <= q(.25) ? 'l1' : v <= q(.5) ? 'l2' : v <= q(.8) ? 'l3' : 'l4');
  const hoje = C.hojeISO();
  let cells = '<i class="vz"></i>'.repeat(offset);
  for (let d = 1; d <= total; d++) {
    const iso = `${ym}-${C.pad(d)}`;
    cells += `<i class="${nivel(dias[d])} ${iso === hoje ? 'hoje' : ''}" title="${C.dataBR(iso)}: ${fmt(dias[d] || 0)}"></i>`;
  }
  const soma = Object.values(dias).reduce((t, v) => t + v, 0);
  return `<div class="card g">
    <div class="lbl">Gastos em ${C.nomeMes(ym)}</div>
    <div class="val">${fmt(soma)}</div>
    <div class="sub">Contas pagas e compras no cartão, por dia</div>
    <div class="heat-h"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
    <div class="heat">${cells}</div>
  </div>`;
}

// ----- Início -----
function telaInicio() {
  const r = C.resumoMes(D, ym);
  const nome = (usuario.displayName || '').split(' ')[0] || 'você';
  const bancos = C.contasBancarias(D);
  const cats = C.gastosPorCategoria(D, ym);
  const gastos = cats.reduce((t, [, v]) => t + v, 0);
  const proximos = [...r.abertos].sort((a, b) => a.data.localeCompare(b.data)).slice(0, 4);
  const ins = C.insights(D, ym, fmt);
  const hora = new Date().getHours();
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  const dots = bancos.length
    ? bancos.slice(0, 4).map((b) => `<span style="background:${b.cor || '#555'}">${b.tipo === 'dinheiro' ? '💵' : '🏦'}</span>`).join('')
    : '<span style="background:rgba(255,255,255,.1)">＋</span>';
  const barra = cats.length
    ? `<div class="catbar">${cats.slice(0, 5).map(([k, v]) => `<i style="flex:${v};background:${C.catInfo(k).c}"></i>`).join('')}</div>`
    : '<div class="catbar vazia"><i></i></div>';

  return `
  <section class="hero">
    <div class="ola">${saud}, ${esc(nome)}</div>
    <div class="hero-lbl">Sobrou em ${C.nomeMes(ym).toLowerCase()} · entrou − pago</div>
    <div class="hero-val ${r.sobra < 0 ? 'neg' : ''}" data-count="${r.sobra}">${fmt(r.sobra)}</div>
    <div class="hero-sub">Previsão pagando tudo: <b class="${r.previsao < 0 ? 'neg' : ''}">${fmt(r.previsao)}</b></div>
  </section>

  <div class="grid2">
    <button class="card g" data-a="ir" data-id="planejar">
      <span class="chev">›</span>
      <div class="card-top"><div class="dots">${dots}</div></div>
      <div class="lbl">Saldo em contas</div>
      <div class="val">${bancos.length ? fmt(C.saldoTotal(D)) : '—'}</div>
      <div class="sub">${bancos.length ? plural(bancos.length, 'carteira', 'carteiras') : 'Adicione suas contas'}</div>
    </button>
    <button class="card g" data-a="ir" data-id="relatorios">
      <span class="chev">›</span>
      <div class="card-top">${barra}</div>
      <div class="lbl">Gastos · ${C.nomeMes(ym)}</div>
      <div class="val">${fmt(gastos)}</div>
      <div class="sub">${plural(cats.length, 'categoria', 'categorias')}</div>
    </button>
  </div>

  <div class="card g">
    <div class="stats">
      <div><div class="lbl">Entrou</div><div class="val pos">${fmt(r.entrou)}</div></div>
      <div><div class="lbl">Pago</div><div class="val">${fmt(r.pago)}</div></div>
      <div><div class="lbl">A pagar</div><div class="val warn">${fmt(r.aPagar)}</div></div>
    </div>
    <div class="barra"><div style="width:${r.pct}%"></div></div>
    <div class="barra-lbl"><span>${r.pct}% das contas pagas</span><span>${r.vencidas.length ? `<span class="neg">${plural(r.vencidas.length, 'vencida', 'vencidas')}</span>` : 'nenhuma vencida'}</span></div>
  </div>

  <div class="sec">
    <div class="sec-h"><h3>Insights</h3></div>
    <div class="scroll-x">${ins.map((i) => `<div class="insight g ${i.tipo}"><span class="e">${i.e}</span><span>${esc(i.t)}</span></div>`).join('')}</div>
  </div>

  <div class="sec">
    <div class="sec-h"><h3>Próximos vencimentos</h3><button data-a="ir" data-id="lanc">Ver tudo</button></div>
    ${proximos.length ? `<div class="list g">${proximos.map(linhaPagavel).join('')}</div>`
      : '<div class="vazio g"><span class="big">🎉</span>Nenhuma conta em aberto neste mês</div>'}
  </div>

  <div class="sec">${heatmap()}</div>`;
}

// ----- Lançamentos -----
function telaLanc() {
  const abas = [['apagar', 'A pagar'], ['pagas', 'Pagas'], ['entradas', 'Entradas'], ['cartoes', 'Cartões']];
  const pills = `<div class="pills">${abas.map(([k, t]) => `<button class="pill g ${sub === k ? 'active' : ''}" data-a="sub" data-id="${k}">${t}</button>`).join('')}</div>`;
  const r = C.resumoMes(D, ym);
  let corpo = '';
  if (sub === 'apagar' || sub === 'pagas') {
    const pagas = sub === 'pagas';
    const l = (pagas ? r.pagos : r.abertos).sort(pagas ? (a, b) => (b.pagoEm || '').localeCompare(a.pagoEm || '') : (a, b) => a.data.localeCompare(b.data));
    corpo = l.length
      ? `<div class="total-linha"><span>${plural(l.length, 'conta', 'contas')}</span><span>Total <b>${fmt(C.soma(l))}</b></span></div><div class="list g">${l.map(linhaPagavel).join('')}</div>`
      : `<div class="vazio g"><span class="big">${pagas ? '🧾' : '🎉'}</span>${pagas ? 'Nenhuma conta paga neste mês ainda' : 'Nada a pagar neste mês.<br>Toque em <b>+</b> para adicionar.'}</div>`;
  } else if (sub === 'entradas') {
    const l = [...r.entradas].sort((a, b) => a.data.localeCompare(b.data));
    const tr = D.transferencias.filter((t) => t.data.startsWith(ym)).sort((a, b) => a.data.localeCompare(b.data));
    corpo = l.length
      ? `<div class="total-linha"><span>${plural(l.length, 'entrada', 'entradas')}</span><span>Total <b>${fmt(C.soma(l))}</b></span></div>
        <div class="list g">${l.map((e) => {
          const cart = e.carteiraId ? carteira(e.carteiraId) : null;
          return `<div class="row"><div class="ic" style="--c:#4ade80">💰</div>
            <div class="info" data-a="editar-entrada" data-id="${e.id}"><div class="t">${esc(e.descricao)}</div>
            <div class="m">${C.dataBR(e.data)}${e.recorrenteId ? ' · 🔁 todo mês' : ''}${cart ? ' · ' + esc(cart.nome) : ''}</div></div>
            <div class="v pos">+ ${fmt(e.valor)}</div></div>`;
        }).join('')}</div>`
      : '<div class="vazio g"><span class="big">💰</span>Nenhuma entrada neste mês.<br>Registre salário e outros recebimentos no <b>+</b>.</div>';
    if (tr.length) {
      corpo += `<div class="sec"><div class="sec-h"><h3>Transferências</h3></div><div class="list g">${tr.map((t) => `<div class="row">
        <div class="ic" style="--c:#60a5fa">🔁</div>
        <div class="info" data-a="editar-transf" data-id="${t.id}"><div class="t">${esc(carteira(t.de)?.nome || '?')} → ${esc(carteira(t.para)?.nome || '?')}</div><div class="m">${C.dataBR(t.data)}</div></div>
        <div class="v">${fmt(t.valor)}</div></div>`).join('')}</div></div>`;
    }
  } else {
    corpo = telaCartoes();
  }
  return pills + corpo;
}

function telaCartoes() {
  const cards = C.cartoes(D);
  if (!cards.length) return '<div class="vazio g"><span class="big">💳</span>Nenhum cartão cadastrado.<br><button class="link" data-a="nova-carteira" data-id="cartao">Adicionar cartão de crédito</button></div>';
  return cards.map((card) => {
    const f = C.faturaDe(D, card, ym);
    const usado = C.limiteUsado(D, card);
    const lim = Number(card.limite) || 0;
    const status = f.pago ? '<span class="tag green">Paga</span>' : f.valor > 0 ? tagVenc(f) : '';
    return `<div class="ccard" style="--c:${card.cor || '#8b5cf6'}">
      <div class="cc-top"><span>${esc(card.nome)}</span><span>💳</span></div>
      <div class="cc-lbl">Fatura de ${C.nomeMes(ym).toLowerCase()}</div>
      <div class="cc-val">${fmt(f.valor)}</div>
      <div class="cc-meta">Fecha ${C.dataBR(f.fecha)} · vence ${C.dataBR(f.data)} ${status}</div>
      ${lim ? `<div class="barra"><div style="width:${Math.min(100, Math.round((usado / lim) * 100))}%"></div></div>
        <div class="cc-meta" style="justify-content:space-between"><span>Usado ${fmt(usado)}</span><span>Disponível ${fmt(Math.max(0, lim - usado))}</span></div>` : ''}
      <div class="cc-btns">
        <button data-a="ver-fatura" data-id="${card.id}">Ver fatura</button>
        <button data-a="nova-compra" data-id="${card.id}">+ Compra</button>
      </div>
    </div>`;
  }).join('');
}

// ----- Planejar -----
function anel(pct, cor, conteudo) {
  const r = 25; const c = 2 * Math.PI * r;
  return `<div class="ring"><svg viewBox="0 0 58 58"><circle cx="29" cy="29" r="${r}" stroke="rgba(255,255,255,.1)"/>
    <circle cx="29" cy="29" r="${r}" stroke="${cor}" stroke-linecap="round" stroke-dasharray="${(Math.min(100, pct) / 100) * c} ${c}"/></svg>${conteudo}</div>`;
}

function telaPlanejar() {
  const orc = C.orcamentosMes(D, ym);
  const carts = D.carteiras;
  const h = C.ymAtual();
  return `
  <div class="sec" style="margin-top:12px">
    <div class="sec-h"><h3>Orçamentos de ${C.nomeMes(ym).toLowerCase()}</h3><button data-a="novo-orcamento">+ Novo</button></div>
    ${orc.length ? `<div class="list g">${orc.map((o) => {
      const ci = C.catInfo(o.categoria);
      const cls = o.pct >= 100 ? 'red' : o.pct >= 80 ? 'amber' : '';
      return `<div class="row" data-a="editar-orcamento" data-id="${o.id}" style="cursor:pointer;flex-wrap:wrap">
        <div class="ic" style="--c:${ci.c}">${ci.e}</div>
        <div class="info"><div class="t">${esc(o.categoria)}</div><div class="m">${fmt(o.gasto)} de ${fmt(o.limite)}</div></div>
        <div class="v ${cls === 'red' ? 'neg' : cls === 'amber' ? 'warn' : ''}">${o.pct}%</div>
        <div class="barra ${cls}" style="width:100%;margin-top:4px"><div style="width:${Math.min(100, o.pct)}%"></div></div>
      </div>`;
    }).join('')}</div>` : '<div class="vazio g"><span class="big">🎯</span>Defina limites de gasto por categoria e acompanhe aqui.</div>'}
  </div>

  <div class="sec">
    <div class="sec-h"><h3>Metas</h3><button data-a="nova-meta">+ Nova</button></div>
    ${D.metas.length ? D.metas.map((m) => {
      const pct = m.alvo > 0 ? Math.round((m.guardado / m.alvo) * 100) : 0;
      let ritmo = '';
      if (m.prazo && m.guardado < m.alvo) {
        const [pa, pm] = m.prazo.split('-').map(Number); const [ha, hm] = h.split('-').map(Number);
        const meses = Math.max(1, (pa - ha) * 12 + (pm - hm));
        ritmo = ` · ${fmt((m.alvo - m.guardado) / meses)}/mês até ${C.nomeMes(m.prazo, true).toLowerCase()}/${m.prazo.slice(2, 4)}`;
      }
      return `<button class="meta g" data-a="editar-meta" data-id="${m.id}">
        ${anel(pct, m.cor || '#c6f432', esc(m.emoji || '🎯'))}
        <div class="info"><div class="t">${esc(m.nome)}</div>
        <div class="v">${fmt(m.guardado)} <span style="color:var(--faint);font-weight:500">de ${fmt(m.alvo)}</span></div>
        <div class="m">${pct >= 100 ? '🎉 Meta atingida!' : `${pct}%${ritmo}`}</div></div>
      </button>`;
    }).join('') : '<div class="vazio g"><span class="big">🏝️</span>Crie metas como viagem ou reserva de emergência.</div>'}
  </div>

  <div class="sec">
    <div class="sec-h"><h3>Carteiras e cartões</h3><button data-a="nova-carteira">+ Nova</button></div>
    ${carts.length ? `<div class="list g">${carts.map((c) => {
      const s = C.saldoCarteira(D, c);
      const tipo = c.tipo === 'cartao' ? `Cartão · vence dia ${c.vencimento}` : c.tipo === 'dinheiro' ? 'Dinheiro' : 'Conta bancária';
      return `<div class="row" data-a="editar-carteira" data-id="${c.id}" style="cursor:pointer">
        <div class="ic" style="--c:${c.cor || '#888'}">${c.tipo === 'cartao' ? '💳' : c.tipo === 'dinheiro' ? '💵' : '🏦'}</div>
        <div class="info"><div class="t">${esc(c.nome)}</div><div class="m">${tipo}</div></div>
        <div class="v ${s < 0 ? 'neg' : ''}">${c.tipo === 'cartao' ? (s ? fmt(-s) + ' usado' : '—') : fmt(s)}</div>
      </div>`;
    }).join('')}</div>
    <button class="add-btn" data-a="nova-transf">🔁 Transferir entre contas</button>`
      : '<div class="vazio g"><span class="big">🏦</span>Cadastre suas contas (Nubank, Itaú, dinheiro…) e cartões para ver o saldo de cada uma.</div>'}
  </div>

  <div class="sec"><button class="add-btn" data-a="recorrencias">🔁 Gerenciar recorrências</button></div>`;
}

// ----- Relatórios -----
function telaRelatorios() {
  const cats = C.gastosPorCategoria(D, ym);
  const total = cats.reduce((t, [, v]) => t + v, 0);
  const R = 60; const circ = 2 * Math.PI * R;
  let acc = 0;
  const segs = cats.map(([k, v]) => {
    const len = (v / total) * circ;
    const s = `<circle cx="75" cy="75" r="${R}" stroke="${C.catInfo(k).c}" stroke-dasharray="${Math.max(0, len - 2)} ${circ}" stroke-dashoffset="${-acc}"/>`;
    acc += len; return s;
  }).join('');
  const donut = cats.length ? `<div class="donut-wrap">
      <div class="donut"><svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="${R}" stroke="rgba(255,255,255,.06)"/>${segs}</svg>
      <div class="c"><div><b>${fmt(total)}</b>no mês</div></div></div>
      <div class="legend">${cats.slice(0, 6).map(([k, v]) => `<div><i style="background:${C.catInfo(k).c}"></i><span>${esc(k)}</span><b>${Math.round((v / total) * 100)}%</b></div>`).join('')}</div>
    </div>` : '<div class="sub" style="margin-top:10px">Sem gastos neste mês.</div>';

  const serie = C.serieMeses(D, ym, 6);
  const max = Math.max(1, ...serie.flatMap((s) => [s.entrou, s.saiu]));
  const bars = `<div class="bars">${serie.map((s) => `<div class="col ${s.ym === ym ? 'atual' : ''}">
      <div class="pair"><i class="in" style="height:${(s.entrou / max) * 100}%" title="Entrou ${fmt(s.entrou)}"></i><i class="out" style="height:${(s.saiu / max) * 100}%" title="Saiu ${fmt(s.saiu)}"></i></div>
      <span>${C.nomeMes(s.ym, true)}</span></div>`).join('')}</div>
    <div class="leg-inline"><span><i style="background:#4ade80"></i>Entrou</span><span><i style="background:#ff6b5a"></i>Contas do mês</span></div>`;
  const comDados = serie.filter((s) => s.entrou || s.saiu);
  const media = comDados.length ? comDados.reduce((t, s) => t + (s.entrou - s.saiu), 0) / comDados.length : 0;

  const ant = Object.fromEntries(C.gastosPorCategoria(D, C.somarMes(ym, -1)));
  const atual = Object.fromEntries(cats);
  const keys = [...new Set([...Object.keys(atual), ...Object.keys(ant)])].sort((a, b) => (atual[b] || 0) - (atual[a] || 0));
  const cmp = keys.length ? keys.map((k) => {
    const a = atual[k] || 0; const b = ant[k] || 0;
    const d = b ? Math.round(((a - b) / b) * 100) : null;
    const ci = C.catInfo(k);
    const delta = d === null ? '<span class="delta" style="color:var(--faint)">novo</span>'
      : `<span class="delta ${d > 0 ? 'neg' : d < 0 ? 'pos' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)}%</span>`;
    return `<div class="row"><div class="ic" style="--c:${ci.c}">${ci.e}</div>
      <div class="info"><div class="t">${esc(k)}</div><div class="m">antes ${fmt(b)}</div></div>
      <div style="text-align:right"><div class="v">${fmt(a)}</div>${delta}</div></div>`;
  }).join('') : '<div class="sub">Sem dados para comparar.</div>';

  return `
  <div class="card g" style="margin-top:12px"><div class="lbl">Para onde foi o dinheiro</div><div class="val">${C.nomeMes(ym)}</div>${donut}</div>
  <div class="card g"><div class="lbl">Últimos 6 meses</div><div class="val ${media < 0 ? 'neg' : 'pos'}">${fmt(media)}<span style="font-size:.8rem;color:var(--muted);font-weight:500"> sobra média/mês</span></div>${bars}</div>
  <div class="card g cmp"><div class="lbl">Comparado a ${C.nomeMes(C.somarMes(ym, -1)).toLowerCase()}</div>${cmp}</div>
  <div class="sec">${heatmap()}</div>`;
}

// ---------------- Modais ----------------
function abrirModal(titulo, html) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = html;
  $('#modal').classList.remove('hidden');
  $('#menu').classList.add('hidden');
  const primeiro = $('#modal-corpo input:not([type=checkbox]):not([type=radio])');
  if (primeiro && window.matchMedia('(pointer: fine)').matches) primeiro.focus();
}
const fecharModal = () => $('#modal').classList.add('hidden');
const dataPadrao = () => (ym === C.ymAtual() ? C.hojeISO() : `${ym}-01`);
const optsCategorias = (sel) => C.CATEGORIAS.map((k) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${C.catInfo(k).e} ${esc(k)}</option>`).join('');
const optsCarteiras = (sel, nenhuma = 'Nenhuma') => `<option value="">${nenhuma}</option>` + C.contasBancarias(D).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
const campoValor = (v, lbl = 'Valor') => `<label>${lbl}</label><input name="valor" class="valor-big" required inputmode="decimal" placeholder="R$ 0,00" value="${v ? Number(v).toFixed(2).replace('.', ',') : ''}">`;
const botoes = (podeExcluir) => `<div class="acoes">${podeExcluir ? '<button type="button" class="btn danger" data-excluir>Excluir</button>' : ''}<button class="btn primary">Salvar</button></div>`;

function lerValor(f) {
  const v = C.parseValor(f.get('valor'));
  if (!(v > 0)) { toast('Informe um valor válido'); return null; }
  return v;
}

// Botão "Excluir" pede confirmação com um segundo toque.
function ligarExcluir(acao) {
  const b = $('#modal-corpo [data-excluir]');
  if (!b) return;
  b.addEventListener('click', () => {
    if (b.dataset.ok !== '1') { b.dataset.ok = '1'; b.textContent = 'Toque de novo para excluir'; return; }
    acao(); fecharModal(); toast('Excluído');
  });
}

function blocoRecorrente(rec) {
  if (!rec) return '';
  return `<div class="aviso">🔁 Lançamento recorrente. Alterações aqui valem só para este mês.
    ${rec.fim ? `<br>Recorrência encerrada em ${C.rotuloMes(rec.fim)}.` : `<br><button type="button" class="btn" style="margin-top:10px;width:100%" data-parar="${rec.id}">Parar de repetir depois deste mês</button>`}</div>`;
}
function ligarParar() {
  const b = $('#modal-corpo [data-parar]');
  if (b) b.addEventListener('click', () => { store.atualizar('recorrentes', b.dataset.parar, { fim: ym }); fecharModal(); toast('Não vai mais repetir após ' + C.rotuloMes(ym)); });
}

function menuNovo() {
  abrirModal('Adicionar', `<div class="acao-grid">
    <button data-a="nova-conta"><span>🧾</span><b>Conta a pagar</b><small>Boleto, aluguel, luz…</small></button>
    <button data-a="nova-entrada"><span>💰</span><b>Entrada</b><small>Salário, Pix recebido…</small></button>
    <button data-a="nova-compra"><span>💳</span><b>Compra no cartão</b><small>À vista ou parcelada</small></button>
    <button data-a="nova-transf"><span>🔁</span><b>Transferência</b><small>Entre suas contas</small></button>
  </div>`);
}

function formConta(c) {
  const novo = !c;
  c = c || { descricao: '', valor: null, data: dataPadrao(), categoria: 'Outros', pago: false, carteiraId: carteiraPadrao() };
  const rec = c.recorrenteId ? D.recorrentes.find((r) => r.id === c.recorrenteId) : null;
  abrirModal(novo ? 'Nova conta a pagar' : 'Editar conta', `<form id="f">
    ${campoValor(c.valor)}
    <label>Descrição</label><input name="descricao" required maxlength="80" placeholder="Ex.: Aluguel, Luz, Internet" value="${esc(c.descricao)}">
    <div class="linha">
      <div><label>Vencimento</label><input name="data" type="date" required value="${c.data}"></div>
      <div><label>Categoria</label><select name="categoria">${optsCategorias(c.categoria)}</select></div>
    </div>
    ${C.contasBancarias(D).length ? `<label>Pagar com</label><select name="carteiraId">${optsCarteiras(c.carteiraId)}</select>` : ''}
    <label class="chk-l"><input type="checkbox" name="pago" ${c.pago ? 'checked' : ''}> Já está paga</label>
    ${novo ? '<label class="chk-l"><input type="checkbox" name="repetir"> Repetir todo mês</label>' : ''}
    ${blocoRecorrente(rec)}
    ${botoes(!novo)}
  </form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const valor = lerValor(f); if (valor === null) return;
    const pago = f.get('pago') === 'on';
    const carteiraId = f.get('carteiraId') || null;
    if (carteiraId) localStorage.setItem('fin-ultima-carteira', carteiraId);
    const dados = { descricao: f.get('descricao').trim(), valor, data: f.get('data'), categoria: f.get('categoria'), carteiraId, pago, pagoEm: pago ? (c.pagoEm || C.hojeISO()) : null };
    if (novo && f.get('repetir') === 'on') {
      const recId = store.novoId(); const mes = dados.data.slice(0, 7);
      store.definir('recorrentes', recId, { tipo: 'conta', descricao: dados.descricao, valor, categoria: dados.categoria, carteiraId, dia: Number(dados.data.slice(8, 10)), inicio: mes, fim: null });
      store.definir('contas', `${recId}_${mes}`, { ...dados, recorrenteId: recId });
      geradosNestaSessao.add(`${recId}_${mes}`);
    } else if (novo) store.adicionar('contas', dados);
    else store.atualizar('contas', c.id, dados);
    fecharModal();
    toast(dados.data.slice(0, 7) !== ym ? `Salva em ${C.rotuloMes(dados.data.slice(0, 7))}` : novo ? 'Conta adicionada' : 'Conta atualizada');
  });
  ligarExcluir(() => (c.recorrenteId ? store.atualizar('contas', c.id, { excluida: true }) : store.remover('contas', c.id)));
  ligarParar();
}

function formEntrada(e) {
  const novo = !e;
  e = e || { descricao: '', valor: null, data: dataPadrao(), carteiraId: carteiraPadrao() };
  const rec = e.recorrenteId ? D.recorrentes.find((r) => r.id === e.recorrenteId) : null;
  abrirModal(novo ? 'Nova entrada' : 'Editar entrada', `<form id="f">
    ${campoValor(e.valor)}
    <label>Descrição</label><input name="descricao" required maxlength="80" placeholder="Ex.: Salário, Freela, Pix" value="${esc(e.descricao)}">
    <div class="linha">
      <div><label>Data</label><input name="data" type="date" required value="${e.data}"></div>
      ${C.contasBancarias(D).length ? `<div><label>Recebido em</label><select name="carteiraId">${optsCarteiras(e.carteiraId)}</select></div>` : ''}
    </div>
    ${novo ? '<label class="chk-l"><input type="checkbox" name="repetir"> Repetir todo mês (ex.: salário)</label>' : ''}
    ${blocoRecorrente(rec)}
    ${botoes(!novo)}
  </form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const valor = lerValor(f); if (valor === null) return;
    const carteiraId = f.get('carteiraId') || null;
    const dados = { descricao: f.get('descricao').trim(), valor, data: f.get('data'), carteiraId };
    if (novo && f.get('repetir') === 'on') {
      const recId = store.novoId(); const mes = dados.data.slice(0, 7);
      store.definir('recorrentes', recId, { tipo: 'entrada', descricao: dados.descricao, valor, carteiraId, dia: Number(dados.data.slice(8, 10)), inicio: mes, fim: null });
      store.definir('entradas', `${recId}_${mes}`, { ...dados, recorrenteId: recId });
      geradosNestaSessao.add(`${recId}_${mes}`);
    } else if (novo) store.adicionar('entradas', dados);
    else store.atualizar('entradas', e.id, dados);
    fecharModal(); toast(novo ? 'Entrada registrada' : 'Entrada atualizada');
  });
  ligarExcluir(() => (e.recorrenteId ? store.atualizar('entradas', e.id, { excluida: true }) : store.remover('entradas', e.id)));
  ligarParar();
}

function formCompra(cp, cardId) {
  const cards = C.cartoes(D);
  if (!cards.length) { formCarteira(null, 'cartao'); toast('Cadastre um cartão primeiro'); return; }
  const novo = !cp;
  cp = cp || { descricao: '', valor: null, data: C.hojeISO(), parcelas: 1, categoria: 'Compras', carteiraId: cardId || cards[0].id };
  abrirModal(novo ? 'Compra no cartão' : 'Editar compra', `<form id="f">
    ${campoValor(cp.valor, 'Valor total')}
    <label>Descrição</label><input name="descricao" required maxlength="80" placeholder="Ex.: Mercado, Tênis, iFood" value="${esc(cp.descricao)}">
    <div class="linha">
      <div><label>Data da compra</label><input name="data" type="date" required value="${cp.data}"></div>
      <div><label>Parcelas</label><select name="parcelas">${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}" ${i + 1 === Number(cp.parcelas) ? 'selected' : ''}>${i === 0 ? 'À vista' : `${i + 1}x`}</option>`).join('')}</select></div>
    </div>
    <div class="linha">
      <div><label>Cartão</label><select name="carteiraId">${cards.map((c) => `<option value="${c.id}" ${c.id === cp.carteiraId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
      <div><label>Categoria</label><select name="categoria">${optsCategorias(cp.categoria)}</select></div>
    </div>
    <div class="aviso" id="prev-parc"></div>
    ${botoes(!novo)}
  </form>`);
  const form = $('#f');
  const prev = () => {
    const f = new FormData(form);
    const v = C.parseValor(f.get('valor')); const card = carteira(f.get('carteiraId'));
    if (!(v > 0) || !card || !f.get('data')) { $('#prev-parc').textContent = 'Informe valor e data para ver as parcelas.'; return; }
    const ps = C.parcelasDe({ valor: v, parcelas: f.get('parcelas'), data: f.get('data') }, card);
    $('#prev-parc').innerHTML = `${ps.length > 1 ? `${ps.length}x de <b>${fmt(ps[ps.length - 1].valor)}</b>` : `<b>${fmt(v)}</b> à vista`} · primeira na fatura de <b>${C.rotuloMes(ps[0].ym).toLowerCase()}</b>${ps.length > 1 ? `, última em ${C.rotuloMes(ps[ps.length - 1].ym).toLowerCase()}` : ''}.`;
  };
  form.addEventListener('input', prev); prev();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const valor = lerValor(f); if (valor === null) return;
    const dados = { descricao: f.get('descricao').trim(), valor, data: f.get('data'), parcelas: Number(f.get('parcelas')), carteiraId: f.get('carteiraId'), categoria: f.get('categoria') };
    if (novo) store.adicionar('compras', dados); else store.atualizar('compras', cp.id, dados);
    fecharModal(); toast(novo ? 'Compra registrada' : 'Compra atualizada');
  });
  ligarExcluir(() => store.remover('compras', cp.id));
}

function verFatura(cardId) {
  const card = carteira(cardId); if (!card) return;
  const f = C.faturaDe(D, card, ym);
  abrirModal(`Fatura ${card.nome}`, `
    <div class="ccard" style="--c:${card.cor || '#8b5cf6'};margin-top:4px">
      <div class="cc-lbl" style="margin-top:0">${C.rotuloMes(ym)}</div><div class="cc-val">${fmt(f.valor)}</div>
      <div class="cc-meta">Fecha ${C.dataBR(f.fecha)} · vence ${C.dataBR(f.data)} ${f.pago ? `<span class="tag green">Paga em ${C.dataBR(f.pagoEm)}</span>` : f.valor ? tagVenc(f) : ''}</div>
    </div>
    <div class="sec" style="margin-top:16px">
      ${f.itens.length ? `<div class="list g">${f.itens.map((p) => {
        const ci = C.catInfo(p.compra.categoria);
        return `<div class="row"><div class="ic" style="--c:${ci.c}">${ci.e}</div>
          <div class="info" data-a="editar-compra" data-id="${p.compra.id}"><div class="t">${esc(p.compra.descricao)}</div>
          <div class="m">${C.dataBR(p.compra.data)}${p.n > 1 ? ` · parcela ${p.i}/${p.n}` : ''}</div></div>
          <div class="v">${fmt(p.valor)}</div></div>`;
      }).join('')}</div>` : '<div class="vazio g">Nenhuma compra nesta fatura.</div>'}
    </div>
    ${f.valor > 0 || f.pago ? `<form id="f">
      ${f.pago ? '' : C.contasBancarias(D).length ? `<label>Pagar com</label><select name="carteiraId">${optsCarteiras(carteiraPadrao())}</select>` : ''}
      <div class="acoes"><button type="button" class="btn" data-a="nova-compra" data-id="${card.id}">+ Compra</button>
      <button class="btn ${f.pago ? '' : 'primary'}">${f.pago ? 'Desfazer pagamento' : 'Pagar fatura'}</button></div>
    </form>` : `<div class="acoes"><button type="button" class="btn primary" data-a="nova-compra" data-id="${card.id}">+ Compra</button></div>`}`);
  const form = $('#f');
  if (form) form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const cid = new FormData(form).get('carteiraId') || null;
    pagarFatura(f, cid);
    fecharModal();
  });
}

function pagarFatura(f, carteiraId) {
  if (f.pago) { store.definir('faturas', f.id, { pago: false, pagoEm: null, carteiraId: null, valor: 0 }); toast('Fatura voltou para "a pagar"'); }
  else { store.definir('faturas', f.id, { pago: true, pagoEm: C.hojeISO(), carteiraId: carteiraId ?? carteiraPadrao(), valor: f.valor }); toast(`${f.descricao} paga`); }
}

function formTransf(t) {
  const bancos = C.contasBancarias(D);
  if (bancos.length < 2) { toast('Cadastre pelo menos 2 contas para transferir'); formCarteira(); return; }
  const novo = !t;
  t = t || { valor: null, data: C.hojeISO(), de: bancos[0].id, para: bancos[1].id };
  const opts = (sel) => bancos.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  abrirModal(novo ? 'Transferência' : 'Editar transferência', `<form id="f">
    ${campoValor(t.valor)}
    <div class="linha"><div><label>De</label><select name="de">${opts(t.de)}</select></div><div><label>Para</label><select name="para">${opts(t.para)}</select></div></div>
    <label>Data</label><input name="data" type="date" required value="${t.data}">
    ${botoes(!novo)}
  </form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const valor = lerValor(f); if (valor === null) return;
    if (f.get('de') === f.get('para')) { toast('Escolha contas diferentes'); return; }
    const dados = { valor, de: f.get('de'), para: f.get('para'), data: f.get('data') };
    if (novo) store.adicionar('transferencias', dados); else store.atualizar('transferencias', t.id, dados);
    fecharModal(); toast('Transferência salva');
  });
  ligarExcluir(() => store.remover('transferencias', t.id));
}

function formCarteira(c, tipoPadrao) {
  const novo = !c;
  c = c || { nome: '', tipo: tipoPadrao || 'conta', cor: C.CORES[D.carteiras.length % C.CORES.length], saldoInicial: 0, limite: '', fechamento: 1, vencimento: 10 };
  const tipos = [['conta', '🏦 Conta'], ['dinheiro', '💵 Dinheiro'], ['cartao', '💳 Cartão']];
  abrirModal(novo ? 'Nova carteira' : 'Editar carteira', `<form id="f">
    <label>Tipo</label>
    <div class="seg">${tipos.map(([k, t]) => `<label><input type="radio" name="tipo" value="${k}" ${c.tipo === k ? 'checked' : ''}>${t}</label>`).join('')}</div>
    <label>Nome</label><input name="nome" required maxlength="40" placeholder="Ex.: Nubank, Itaú, Carteira" value="${esc(c.nome)}">
    <label>Cor</label>
    <div class="cores">${C.CORES.map((k) => `<label style="background:${k}"><input type="radio" name="cor" value="${k}" ${c.cor === k ? 'checked' : ''}></label>`).join('')}</div>
    <div id="campos-conta">
      <label>Saldo inicial</label><input name="saldoInicial" inputmode="decimal" placeholder="0,00" value="${Number(c.saldoInicial || 0).toFixed(2).replace('.', ',')}">
      <div class="aviso">Quanto havia nesta conta ao começar a usar o app. Entradas, contas pagas e transferências ligadas a ela atualizam o saldo.</div>
    </div>
    <div id="campos-cartao">
      <label>Limite (opcional)</label><input name="limite" inputmode="decimal" placeholder="0,00" value="${c.limite ? Number(c.limite).toFixed(2).replace('.', ',') : ''}">
      <div class="linha">
        <div><label>Dia do fechamento</label><input name="fechamento" type="number" min="1" max="31" value="${c.fechamento || 1}"></div>
        <div><label>Dia do vencimento</label><input name="vencimento" type="number" min="1" max="31" value="${c.vencimento || 10}"></div>
      </div>
    </div>
    ${botoes(!novo)}
  </form>`);
  const form = $('#f');
  const alternar = () => {
    const t = new FormData(form).get('tipo');
    $('#campos-conta').classList.toggle('hidden', t === 'cartao');
    $('#campos-cartao').classList.toggle('hidden', t !== 'cartao');
  };
  form.addEventListener('change', alternar); alternar();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const tipo = f.get('tipo');
    const dados = { nome: f.get('nome').trim(), tipo, cor: f.get('cor') || C.CORES[0] };
    if (tipo === 'cartao') {
      const fe = Number(f.get('fechamento')); const ve = Number(f.get('vencimento'));
      if (!(fe >= 1 && fe <= 31 && ve >= 1 && ve <= 31)) { toast('Dias de fechamento e vencimento entre 1 e 31'); return; }
      Object.assign(dados, { limite: C.parseValor(f.get('limite')) || 0, fechamento: fe, vencimento: ve });
    } else {
      dados.saldoInicial = C.parseValor(f.get('saldoInicial')) || 0;
    }
    if (novo) store.adicionar('carteiras', dados); else store.definir('carteiras', c.id, dados);
    fecharModal(); toast(novo ? 'Carteira criada' : 'Carteira atualizada');
  });
  ligarExcluir(() => store.remover('carteiras', c.id));
  if (!novo && c.tipo === 'cartao' && D.compras.some((x) => x.carteiraId === c.id)) {
    form.insertAdjacentHTML('beforeend', '<div class="aviso">Excluir o cartão esconde as compras dele dos cálculos.</div>');
  }
}

function formOrcamento(o) {
  const novo = !o;
  const usados = new Set(D.orcamentos.map((x) => x.categoria));
  const livres = C.CATEGORIAS.filter((k) => !usados.has(k) || (o && o.categoria === k));
  if (novo && !livres.length) { toast('Todas as categorias já têm orçamento'); return; }
  o = o || { categoria: livres[0], limite: null };
  const gasto = Object.fromEntries(C.gastosPorCategoria(D, ym))[o.categoria] || 0;
  abrirModal(novo ? 'Novo orçamento' : `Orçamento · ${o.categoria}`, `<form id="f">
    ${novo ? `<label>Categoria</label><select name="categoria">${livres.map((k) => `<option value="${esc(k)}">${C.catInfo(k).e} ${esc(k)}</option>`).join('')}</select>` : ''}
    ${campoValor(o.limite, 'Limite por mês')}
    ${novo ? '' : `<div class="aviso">Gasto em ${C.nomeMes(ym).toLowerCase()}: <b>${fmt(gasto)}</b></div>`}
    ${botoes(!novo)}
  </form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const limite = lerValor(f); if (limite === null) return;
    const cat = novo ? f.get('categoria') : o.categoria;
    store.definir('orcamentos', novo ? C.slug(cat) : o.id, { categoria: cat, limite });
    fecharModal(); toast('Orçamento salvo');
  });
  ligarExcluir(() => store.remover('orcamentos', o.id));
}

function formMeta(m) {
  const novo = !m;
  m = m || { nome: '', emoji: '🎯', alvo: null, guardado: 0, prazo: '', cor: '#c6f432' };
  const emojis = ['🎯', '🏝️', '🚗', '🏠', '🛟', '🎓', '💍', '📱', '✈️', '🐶'];
  const pct = m.alvo > 0 ? Math.round((m.guardado / m.alvo) * 100) : 0;
  abrirModal(novo ? 'Nova meta' : m.nome, `
    ${novo ? '' : `<div style="display:flex;align-items:center;gap:16px;margin:6px 0 4px">${anel(pct, m.cor, esc(m.emoji))}
      <div><div class="val" style="font-size:1.5rem;font-weight:700">${fmt(m.guardado)}</div><div class="sub" style="color:var(--muted)">de ${fmt(m.alvo)} · ${pct}%</div></div></div>
      <form id="fm"><label>Movimentar</label><input name="mov" inputmode="decimal" placeholder="R$ 0,00">
      <div class="acoes" style="margin-top:10px"><button type="button" class="btn" data-mov="-1">− Retirar</button><button type="button" class="btn primary" data-mov="1">+ Guardar</button></div></form>
      <div class="lbl-f" style="margin-top:22px;font-weight:600;color:var(--text)">Editar meta</div>`}
    <form id="f">
      <label>Ícone</label>
      <div class="seg" style="flex-wrap:wrap">${emojis.map((e) => `<label style="flex:0 0 calc(20% - 4px)"><input type="radio" name="emoji" value="${e}" ${m.emoji === e ? 'checked' : ''}>${e}</label>`).join('')}</div>
      <label>Nome</label><input name="nome" required maxlength="40" placeholder="Ex.: Viagem, Reserva de emergência" value="${esc(m.nome)}">
      <div class="linha">
        <div><label>Valor da meta</label><input name="alvo" required inputmode="decimal" placeholder="0,00" value="${m.alvo ? Number(m.alvo).toFixed(2).replace('.', ',') : ''}"></div>
        <div><label>Prazo (opcional)</label><input name="prazo" type="month" value="${m.prazo || ''}"></div>
      </div>
      ${novo ? '<label>Já guardado</label><input name="guardado" inputmode="decimal" placeholder="0,00">' : ''}
      ${botoes(!novo)}
    </form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const alvo = C.parseValor(f.get('alvo'));
    if (!(alvo > 0)) { toast('Informe o valor da meta'); return; }
    const cor = ['#c6f432', '#ff7a45', '#a78bfa', '#22d3ee', '#f472b6'][D.metas.length % 5];
    const dados = { nome: f.get('nome').trim(), emoji: f.get('emoji') || '🎯', alvo, prazo: f.get('prazo') || '' };
    if (novo) store.adicionar('metas', { ...dados, cor, guardado: C.parseValor(f.get('guardado')) || 0 });
    else store.atualizar('metas', m.id, dados);
    fecharModal(); toast('Meta salva');
  });
  $$('#modal-corpo [data-mov]').forEach((b) => b.addEventListener('click', () => {
    const v = C.parseValor($('#fm [name=mov]').value);
    if (!(v > 0)) { toast('Informe um valor'); return; }
    const novoV = C.r2(Math.max(0, (Number(m.guardado) || 0) + v * Number(b.dataset.mov)));
    store.atualizar('metas', m.id, { guardado: novoV });
    fecharModal();
    toast(novoV >= m.alvo && b.dataset.mov === '1' ? `🎉 Meta "${m.nome}" atingida!` : b.dataset.mov === '1' ? `Guardado ${fmt(v)}` : `Retirado ${fmt(v)}`);
  }));
  ligarExcluir(() => store.remover('metas', m.id));
}

function gerenciarRecorrencias() {
  const h = C.ymAtual();
  const ativas = D.recorrentes.filter((r) => !r.fim || r.fim >= h);
  abrirModal('Recorrências', ativas.length ? `<div class="list g">${ativas.map((r) => `<div class="row">
      <div class="ic" style="--c:${r.tipo === 'entrada' ? '#4ade80' : C.catInfo(r.categoria).c}">${r.tipo === 'entrada' ? '💰' : C.catInfo(r.categoria).e}</div>
      <div class="info"><div class="t">${esc(r.descricao)}</div><div class="m">Todo dia ${r.dia}${r.fim ? ' · até ' + C.rotuloMes(r.fim).toLowerCase() : ''}</div></div>
      <div class="v ${r.tipo === 'entrada' ? 'pos' : ''}">${fmt(r.valor)}</div>
      ${r.fim ? '' : `<button class="btn danger" style="flex:0;padding:8px 12px;font-size:.8rem" data-encerrar="${r.id}">Encerrar</button>`}
    </div>`).join('')}</div>
    <div class="aviso">Encerrar mantém o que já foi lançado e para de criar depois de ${C.rotuloMes(ym).toLowerCase()}. Para mudar o valor, encerre e crie de novo.</div>`
    : '<div class="vazio g">Nenhuma recorrência ativa. Ao criar uma conta ou entrada, marque "Repetir todo mês".</div>');
  $$('#modal-corpo [data-encerrar]').forEach((b) => b.addEventListener('click', () => {
    store.atualizar('recorrentes', b.dataset.encerrar, { fim: ym }); fecharModal(); toast('Recorrência encerrada');
  }));
}

async function exportar() {
  const dados = await store.exportarTudo();
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `financas-backup-${C.hojeISO()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function atualizarOlho() {
  $('#btn-olho').innerHTML = ocultar ? ICON_OLHO_OFF : ICON_OLHO;
}

function mudarMes(n) {
  ym = C.somarMes(ym, n);
  gerarRecorrentes();
  render();
  $('#conteudo').classList.remove('fade-in'); void $('#conteudo').offsetWidth; $('#conteudo').classList.add('fade-in');
}

// ---------------- Eventos ----------------
const ACOES = {
  menu: () => $('#menu').classList.toggle('hidden'),
  hoje: () => { $('#menu').classList.add('hidden'); ym = C.ymAtual(); mudarMes(0); },
  recorrencias: gerenciarRecorrencias,
  exportar: () => { $('#menu').classList.add('hidden'); exportar(); },
  sair: () => { $('#menu').classList.add('hidden'); store.sair(); },
  ir: (id) => trocarTela(id),
  sub: (id) => { sub = id; render(); },
  novo: menuNovo,
  'nova-conta': () => formConta(),
  'nova-entrada': () => formEntrada(),
  'nova-compra': (id) => formCompra(null, id),
  'nova-transf': () => formTransf(),
  'nova-carteira': (id) => formCarteira(null, id),
  'novo-orcamento': () => formOrcamento(),
  'nova-meta': () => formMeta(),
  'editar-conta': (id) => { const x = D.contas.find((c) => c.id === id); if (x) formConta(x); },
  'editar-entrada': (id) => { const x = D.entradas.find((c) => c.id === id); if (x) formEntrada(x); },
  'editar-compra': (id) => { const x = D.compras.find((c) => c.id === id); if (x) formCompra(x); },
  'editar-transf': (id) => { const x = D.transferencias.find((c) => c.id === id); if (x) formTransf(x); },
  'editar-carteira': (id) => { const x = carteira(id); if (x) formCarteira(x); },
  'editar-orcamento': (id) => { const x = D.orcamentos.find((c) => c.id === id); if (x) formOrcamento(x); },
  'editar-meta': (id) => { const x = D.metas.find((c) => c.id === id); if (x) formMeta(x); },
  'ver-fatura': (id) => verFatura(id),
  pagar: (id, el) => {
    if (el.dataset.tipo === 'fatura') {
      const [cardId] = id.split('_');
      const card = carteira(cardId); if (!card) return;
      pagarFatura(C.faturaDe(D, card, id.slice(cardId.length + 1)));
      return;
    }
    const c = D.contas.find((x) => x.id === id); if (!c) return;
    const pagar = !c.pago;
    store.atualizar('contas', c.id, { pago: pagar, pagoEm: pagar ? C.hojeISO() : null, carteiraId: c.carteiraId || (pagar ? carteiraPadrao() : null) });
    toast(pagar ? `"${c.descricao}" paga ✓` : 'Voltou para "a pagar"');
  },
};

function ligarEventos() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!e.target.closest('#menu') && !e.target.closest('[data-a="menu"]')) $('#menu').classList.add('hidden');
    if (!el) return;
    const fn = ACOES[el.dataset.a];
    if (fn) { e.preventDefault(); fn(el.dataset.id, el); }
  });
  $$('.dock [data-tela]').forEach((b) => b.addEventListener('click', () => trocarTela(b.dataset.tela)));
  $('#mes-ant').addEventListener('click', () => mudarMes(-1));
  $('#mes-prox').addEventListener('click', () => mudarMes(1));
  $('#btn-olho').addEventListener('click', () => {
    ocultar = !ocultar; localStorage.setItem('fin-ocultar', ocultar ? '1' : '0');
    atualizarOlho(); render();
  });
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });
  window.addEventListener('scroll', () => $('.top').classList.toggle('scrolled', window.scrollY > 10), { passive: true });

  // Deslizar para os lados troca o mês.
  let x0 = null; let y0 = null;
  const main = $('#conteudo');
  main.addEventListener('touchstart', (e) => {
    if (e.target.closest('.scroll-x, .pills')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) mudarMes(dx < 0 ? 1 : -1);
    x0 = null;
  }, { passive: true });
}

iniciar();
