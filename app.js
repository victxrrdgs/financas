import { criarStore, modoLocal, COLECOES } from './store.js?v=2.3';
import * as C from './calc.js?v=2.3';
import * as L from './lock.js?v=2.3';

const VERSAO = '2.3';

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
let ocultar = localStorage.getItem('fin-ocultar') === '1' || localStorage.getItem('fin-ocultar-abrir') === '1';
const D = Object.fromEntries(COLECOES.map((c) => [c, []]));
const srv = {};
let syncStatus = '';
let configVista = false;
let apagando = false;
const prefs = () => D.config.find((x) => x.id === 'prefs') || {};
const modCom = () => !!prefs().modComissoes;
let filtroEmpresa = '';
const salvarPrefs = (mud) => { const { id, ...atual } = prefs(); store.definir('config', 'prefs', { ...atual, ...mud }); };
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
  store.assinarStatus((s) => { syncStatus = s; });
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
  $('#avatar').innerHTML = avatarHTML();
  if (L.config()) travar();
  paradas.forEach((f) => f());
  paradas = COLECOES.map((col) => store.assinar(col, (lista, doServidor) => {
    D[col] = lista; srv[col] = doServidor;
    if (col === 'config') {
      const antes = C.diaInicio();
      C.configurar(prefs());
      // Ao carregar as preferências pela 1ª vez, abre no mês financeiro atual.
      if (!configVista || antes !== C.diaInicio()) { ym = C.ymAtual(); configVista = true; }
    }
    gerarRecorrentes();
    agendarRender();
  }));
  agendarRender();
}

const avatarHTML = () => (usuario.photoURL
  ? `<img src="${esc(usuario.photoURL)}" alt="" referrerpolicy="no-referrer">`
  : esc(((usuario.displayName || '?')[0]).toUpperCase()));

let renderPendente = false;
function agendarRender() {
  if (renderPendente) return;
  renderPendente = true;
  requestAnimationFrame(() => { renderPendente = false; render(); });
}

// Cria os lançamentos das recorrências para o mês aberto e o atual.
// Só roda com dados confirmados pelo servidor, para não duplicar nem sobrescrever.
function gerarRecorrentes() {
  if (apagando || !srv.contas || !srv.entradas || !srv.recorrentes || !srv.config) return;
  C.configurar(prefs());
  for (const mes of new Set([ym, C.ymAtual()])) {
    for (const r of D.recorrentes) {
      if (!r.inicio || r.inicio > mes || (r.fim && mes > r.fim)) continue;
      const id = `${r.id}_${mes}`;
      const col = r.tipo === 'entrada' ? 'entradas' : 'contas';
      if (D[col].some((x) => x.id === id) || geradosNestaSessao.has(id)) continue;
      geradosNestaSessao.add(id);
      const doc = { descricao: r.descricao, valor: r.valor, data: C.dataNoPeriodo(mes, r.dia), recorrenteId: r.id, carteiraId: r.carteiraId || null };
      if (col === 'contas') Object.assign(doc, { categoria: r.categoria || 'Outros', pago: false, pagoEm: null });
      store.definir(col, id, doc);
    }
  }
}

// ---------------- Render ----------------
function render() {
  C.configurar(prefs());
  $('#mes-label').textContent = C.rotuloMes(ym);
  $('#avatar').classList.toggle('ativo', tela === 'conta');
  $$('.dock [data-tela]').forEach((b) => b.classList.toggle('active', b.dataset.tela === tela));
  const el = $('#conteudo');
  const html = { inicio: telaInicio, lanc: telaLanc, planejar: telaPlanejar, relatorios: telaRelatorios, conta: telaConta }[tela]();
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
  const lista = C.diasDoPeriodo(ym);
  const [a, m, d0] = lista[0].split('-').map(Number);
  const offset = new Date(a, m - 1, d0).getDay();
  const vals = Object.values(dias).filter((v) => v > 0).sort((x, y) => x - y);
  const q = (p) => vals[Math.floor((vals.length - 1) * p)] || 0;
  const nivel = (v) => (!v ? '' : v <= q(.25) ? 'l1' : v <= q(.5) ? 'l2' : v <= q(.8) ? 'l3' : 'l4');
  const hoje = C.hojeISO();
  let cells = '<i class="vz"></i>'.repeat(offset);
  for (const iso of lista) {
    cells += `<i class="${nivel(dias[iso])} ${iso === hoje ? 'hoje' : ''}" title="${C.dataBR(iso)}: ${fmt(dias[iso] || 0)}"></i>`;
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
  const nome = prefs().apelido || (usuario.displayName || '').split(' ')[0] || 'você';
  const [pIni, pFim] = C.periodo(ym);
  const faixa = C.diaInicio() > 1 ? ` (${C.dataBR(pIni)} a ${C.dataBR(pFim)})` : '';
  const bancos = C.contasBancarias(D);
  const cats = C.gastosPorCategoria(D, ym);
  const gastos = cats.reduce((t, [, v]) => t + v, 0);
  const proximos = [...r.abertos].sort((a, b) => a.data.localeCompare(b.data)).slice(0, 4);
  const ins = C.insights(D, ym, fmt, { comissoes: modCom() });
  const rc = modCom() ? C.resumoComissoes(D, ym) : null;
  const previsao = C.r2(r.previsao + (rc ? rc.previstoMes : 0));
  const proxCom = rc ? [...rc.pendentes].sort((a, b) => a.data.localeCompare(b.data))[0] : null;
  const cardCom = rc ? `<button class="card g" data-a="ir-comissoes" style="margin-top:12px">
      <span class="chev">›</span>
      <div class="lbl">💼 Comissões a receber</div>
      <div class="stats" style="margin-top:8px">
        <div><div class="lbl">Neste mês</div><div class="val pos">${fmt(rc.previstoMes)}</div></div>
        <div><div class="lbl">Total pendente</div><div class="val">${fmt(rc.aReceber)}</div></div>
        <div><div class="lbl">Recebido</div><div class="val">${fmt(rc.recebidoMes)}</div></div>
      </div>
      ${proxCom ? `<div class="sub" style="margin-top:10px">Próxima: ${esc(proxCom.com.empresa)} · ${C.dataBR(proxCom.data)} · ${fmt(proxCom.valor)}${rc.atrasadas.length ? ` · <span class="neg">${plural(rc.atrasadas.length, 'atrasada', 'atrasadas')}</span>` : ''}</div>` : ''}
    </button>` : '';
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
    <div class="hero-lbl">Sobrou em ${C.nomeMes(ym).toLowerCase()}${faixa} · entrou − pago</div>
    <div class="hero-val ${r.sobra < 0 ? 'neg' : ''}" data-count="${r.sobra}">${fmt(r.sobra)}</div>
    <div class="hero-sub">Previsão pagando tudo${rc && rc.previstoMes ? ' e recebendo as comissões' : ''}: <b class="${previsao < 0 ? 'neg' : ''}">${fmt(previsao)}</b></div>
  </section>

  <div class="grid2">
    <button class="card g" data-a="ir" data-id="planejar">
      <span class="chev">›</span>
      <div class="card-top"><div class="dots">${dots}</div></div>
      <div class="lbl">Saldo em contas</div>
      <div class="val ${C.saldoTotal(D) < 0 ? 'neg' : ''}">${bancos.length ? fmt(C.saldoTotal(D)) : '—'}</div>
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
  ${cardCom}

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
  if (modCom()) abas.push(['comissoes', '💼 Comissões']);
  else if (sub === 'comissoes') sub = 'apagar';
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
    const tr = D.transferencias.filter((t) => C.noMes(t.data, ym)).sort((a, b) => a.data.localeCompare(b.data));
    corpo = l.length
      ? `<div class="total-linha"><span>${plural(l.length, 'entrada', 'entradas')}</span><span>Total <b>${fmt(C.soma(l))}</b></span></div>
        <div class="list g">${l.map((e) => {
          const cart = e.carteiraId ? carteira(e.carteiraId) : null;
          return `<div class="row"><div class="ic" style="--c:${e.comissaoId ? '#fbbf24' : '#4ade80'}">${e.comissaoId ? '💼' : '💰'}</div>
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
  } else if (sub === 'comissoes') {
    corpo = telaComissoes();
  } else {
    corpo = telaCartoes();
  }
  return pills + corpo;
}

// ----- Comissões -----
function tagComissao(p) {
  if (p.com.cancelada) return '<span class="tag red">Venda cancelada</span>';
  if (p.recebido) return `<span class="tag green">Recebida ${C.dataBR(p.recebidoEm)}</span>`;
  const d = C.diasAte(p.data);
  if (d < 0) return `<span class="tag red">Atrasada ${plural(-d, 'dia', 'dias')}</span>`;
  if (C.noMes(p.data, C.ymAtual())) return '<span class="tag amber">Este mês</span>';
  return '';
}

function linhaComissao(p) {
  return `<div class="row">
    <div class="ic" style="--c:#fbbf24">💼</div>
    <div class="info" data-a="editar-comissao" data-id="${p.com.id}">
      <div class="t">${esc(p.com.empresa)}</div>
      <div class="m">${esc(p.com.produto || '—')} · ${p.recebido ? 'recebida' : 'prevista'} ${C.dataBR(p.recebido ? p.recebidoEm : p.data)}${p.n > 1 ? ` · ${p.i + 1}/${p.n}` : ''} ${tagComissao(p)}</div>
    </div>
    <div class="v ${p.recebido ? 'pos' : ''}">${fmt(p.valor)}</div>
    <button class="chk ${p.recebido ? 'on' : ''}" data-a="receber" data-id="${p.com.id}" data-i="${p.i}" aria-label="${p.recebido ? 'Desmarcar recebimento' : 'Marcar como recebida'}">✓</button>
  </div>`;
}

function telaComissoes() {
  const rc = C.resumoComissoes(D, ym);
  const empresas = [...new Set((D.comissoes || []).map((c) => c.empresa).filter(Boolean))].sort();
  if (filtroEmpresa && !empresas.includes(filtroEmpresa)) filtroEmpresa = '';
  const filtra = (l) => (filtroEmpresa ? l.filter((p) => p.com.empresa === filtroEmpresa) : l);
  const pend = filtra([...rc.pendentes]).sort((a, b) => a.data.localeCompare(b.data));
  const receb = filtra([...rc.recebidasMes]).sort((a, b) => (b.recebidoEm || '').localeCompare(a.recebidoEm || ''));
  const vendas = rc.vendasMes.filter((c) => !filtroEmpresa || c.empresa === filtroEmpresa);
  if (!D.comissoes.length) {
    return `<div class="vazio g"><span class="big">💼</span>Nenhuma venda registrada ainda.<br>
      <button class="link" data-a="nova-comissao">Registrar uma venda</button></div>`;
  }
  return `
  <div class="card g">
    <div class="stats">
      <div><div class="lbl">Previsto em ${C.nomeMes(ym, true).toLowerCase()}</div><div class="val warn">${fmt(rc.previstoMes)}</div></div>
      <div><div class="lbl">Recebido</div><div class="val pos">${fmt(rc.recebidoMes)}</div></div>
      <div><div class="lbl">Total pendente</div><div class="val">${fmt(rc.aReceber)}</div></div>
    </div>
    <div class="barra-lbl" style="margin-top:12px"><span>Vendido em ${C.nomeMes(ym).toLowerCase()}: <b style="color:var(--text)">${fmt(rc.vendidoMes)}</b></span><span>comissão ${fmt(rc.geradoMes)}</span></div>
  </div>
  ${empresas.length > 1 ? `<form id="f-filtro" style="margin-top:12px"><select name="emp" data-filtro-emp>
      <option value="">Todas as empresas</option>${empresas.map((e) => `<option ${e === filtroEmpresa ? 'selected' : ''}>${esc(e)}</option>`).join('')}
    </select></form>` : ''}
  <div class="sec">
    <div class="sec-h"><h3>A receber</h3><button data-a="nova-comissao">+ Venda</button></div>
    ${pend.length ? `<div class="list g">${pend.map(linhaComissao).join('')}</div>` : '<div class="vazio g">Nada pendente 🎉</div>'}
  </div>
  <div class="sec">
    <div class="sec-h"><h3>Recebidas em ${C.nomeMes(ym).toLowerCase()}</h3></div>
    ${receb.length ? `<div class="list g">${receb.map(linhaComissao).join('')}</div>` : '<div class="vazio g">Nenhuma comissão recebida neste mês.</div>'}
  </div>
  ${vendas.length ? `<div class="sec"><div class="sec-h"><h3>Vendas fechadas em ${C.nomeMes(ym).toLowerCase()}</h3></div><div class="list g">
    ${vendas.map((c) => `<div class="row clic" data-a="editar-comissao" data-id="${c.id}"><div class="ic" style="--c:#60a5fa">🤝</div>
      <div class="info"><div class="t">${esc(c.empresa)}</div><div class="m">${esc(c.produto || '—')} · ${C.dataBR(c.dataVenda)} · ${String(c.percentual).replace('.', ',')}%</div></div>
      <div style="text-align:right"><div class="v">${fmt(c.valorVenda)}</div><div class="m" style="color:var(--muted);font-size:.74rem">comissão ${fmt(C.soma(c.parcelas || []))}</div></div></div>`).join('')}
  </div></div>` : ''}`;
}

function receberComissao(id, i) {
  const com = D.comissoes.find((c) => c.id === id); if (!com) return;
  const ps = (com.parcelas || []).map((p) => ({ ...p }));
  const p = ps[i]; if (!p) return;
  const entradaId = `com-${id}-${i}`;
  const n = ps.length;
  if (p.recebido) {
    Object.assign(p, { recebido: false, recebidoEm: null, carteiraId: null });
    store.remover('entradas', entradaId);
    toast('Comissão voltou para "a receber"');
  } else {
    const carteiraId = carteiraPadrao();
    Object.assign(p, { recebido: true, recebidoEm: C.hojeISO(), carteiraId });
    store.definir('entradas', entradaId, {
      descricao: `Comissão · ${com.empresa}${n > 1 ? ` (${i + 1}/${n})` : ''}`, valor: p.valor, data: C.hojeISO(), carteiraId, comissaoId: id,
    });
    toast(`💼 Comissão de ${fmt(p.valor)} recebida`);
  }
  store.atualizar('comissoes', id, { parcelas: ps });
}

// Datas previstas dos pagamentos do cliente: mesmo dia, mês a mês, a partir do 1º.
const datasParcelas = (d1, n) => Array.from({ length: n }, (_, i) => (i === 0 ? d1 : C.diaNoMes(C.somarMes(d1.slice(0, 7), i), Number(d1.slice(8, 10)))));

function formComissao(com) {
  const novo = !com;
  const pctPadrao = Number(prefs().percentualComissao) || 1;
  com = com || { empresa: '', produto: '', dataVenda: C.hojeISO(), valorVenda: null, percentual: pctPadrao, parcelas: [], cancelada: false, obs: '' };
  const ps = com.parcelas || [];
  const totalCom = ps.length ? C.soma(ps) : null;
  const recebidas = ps.filter((p) => p.recebido).length;
  const empresas = [...new Set(D.comissoes.map((c) => c.empresa).filter(Boolean))];
  const produtos = [...new Set(D.comissoes.map((c) => c.produto).filter(Boolean))];
  const num = (v) => (v || v === 0 ? Number(v).toFixed(2).replace('.', ',') : '');
  abrirModal(novo ? 'Nova venda' : 'Editar venda', `<form id="f">
    ${campoValor(com.valorVenda, 'Valor da venda')}
    <div class="linha">
      <div><label>Empresa (cliente)</label><input name="empresa" list="dl-emp" required maxlength="60" placeholder="Quem comprou" value="${esc(com.empresa)}"></div>
      <div><label>Produto</label><input name="produto" list="dl-prod" maxlength="60" placeholder="O que foi vendido" value="${esc(com.produto)}"></div>
    </div>
    <datalist id="dl-emp">${empresas.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
    <datalist id="dl-prod">${produtos.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
    <div class="linha">
      <div><label>Data da venda</label><input name="dataVenda" type="date" required value="${com.dataVenda}"></div>
      <div><label>Comissão (%)</label><input name="percentual" inputmode="decimal" required value="${String(com.percentual ?? pctPadrao).replace('.', ',')}"></div>
    </div>
    <div class="linha">
      <div><label>Cliente paga em</label><select name="n">${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}" ${i + 1 === (ps.length || 1) ? 'selected' : ''}>${i === 0 ? '1 pagamento' : `${i + 1} parcelas`}</option>`).join('')}</select></div>
      <div><label>${'1º pagamento do cliente'}</label><input name="data1" type="date" required value="${ps[0]?.data || com.dataVenda}"></div>
    </div>
    <label>Comissão total (calculada, pode ajustar)</label><input name="comissao" inputmode="decimal" placeholder="0,00" value="${num(totalCom)}">
    <div class="aviso" id="prev-com"></div>
    <label>Observação</label><input name="obs" maxlength="120" placeholder="Opcional: nº do pedido, contato…" value="${esc(com.obs || '')}">
    ${novo ? '' : `<label class="chk-l"><input type="checkbox" name="cancelada" ${com.cancelada ? 'checked' : ''}> Venda cancelada</label>`}
    ${recebidas ? `<div class="aviso">${plural(recebidas, 'parcela já recebida', 'parcelas já recebidas')}: o recebimento fica mantido.</div>` : ''}
    ${botoes(!novo)}
  </form>`);
  const form = $('#f');
  let comissaoEditada = !novo && totalCom !== null && Math.abs(totalCom - C.r2((com.valorVenda * com.percentual) / 100)) > 0.009;
  const calcular = (ev) => {
    const f = new FormData(form);
    if (ev && ev.target.name === 'comissao') comissaoEditada = true;
    const venda = C.parseValor(f.get('valor'));
    const pct = C.parseValor(f.get('percentual'));
    if (!comissaoEditada && venda > 0 && pct >= 0) form.comissao.value = num(C.r2((venda * pct) / 100));
    const total = C.parseValor(form.comissao.value);
    const n = Number(f.get('n')); const d1 = f.get('data1');
    if (!(total > 0) || !d1) { $('#prev-com').textContent = 'Informe o valor da venda para calcular a comissão.'; return; }
    const partes = C.dividir(total, n);
    const meses = datasParcelas(d1, n).map((d) => C.rotuloMes(C.mesDe(d)).toLowerCase());
    $('#prev-com').innerHTML = n === 1
      ? `Você recebe <b>${fmt(total)}</b> em <b>${meses[0]}</b>, quando o cliente pagar.`
      : `${n} parcelas de <b>${fmt(partes[n - 1])}</b> de comissão, de <b>${meses[0]}</b> a <b>${meses[n - 1]}</b>.`;
  };
  form.addEventListener('input', calcular); calcular();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const valorVenda = lerValor(f); if (valorVenda === null) return;
    const percentual = C.parseValor(f.get('percentual'));
    if (!(percentual >= 0 && percentual <= 100)) { toast('Percentual inválido'); return; }
    const total = C.parseValor(form.comissao.value);
    if (!(total > 0)) { toast('Informe a comissão'); return; }
    const n = Number(f.get('n')); const d1 = f.get('data1');
    const partes = C.dividir(total, n);
    const datas = datasParcelas(d1, n);
    const novas = partes.map((valor, i) => {
      const antiga = ps[i] || {};
      const data = datas[i];
      return { data, valor, valorVenda: C.dividir(valorVenda, n)[i], recebido: !!antiga.recebido, recebidoEm: antiga.recebidoEm || null, carteiraId: antiga.carteiraId || null };
    });
    // Parcelas que deixaram de existir: remove a entrada, se tinham sido recebidas.
    ps.slice(n).forEach((p, k) => { if (p.recebido) store.remover('entradas', `com-${com.id}-${n + k}`); });
    const dados = {
      empresa: f.get('empresa').trim(), produto: f.get('produto').trim(), dataVenda: f.get('dataVenda'),
      valorVenda, percentual, parcelas: novas, cancelada: f.get('cancelada') === 'on', obs: f.get('obs').trim(),
    };
    if (novo) store.adicionar('comissoes', dados);
    else {
      store.definir('comissoes', com.id, dados);
      // Mantém as entradas já criadas com o valor atualizado.
      novas.forEach((p, i) => { if (p.recebido) store.atualizar('entradas', `com-${com.id}-${i}`, { valor: p.valor, descricao: `Comissão · ${dados.empresa}${n > 1 ? ` (${i + 1}/${n})` : ''}` }); });
    }
    fecharModal(); toast(novo ? '💼 Venda registrada' : 'Venda atualizada');
  });
  ligarExcluir(() => {
    ps.forEach((p, i) => { if (p.recebido) store.remover('entradas', `com-${com.id}-${i}`); });
    store.remover('comissoes', com.id);
  });
}

function configPercentual() {
  abrirModal('Comissão padrão', `<form id="f">
    <label>Percentual sugerido em novas vendas</label><input name="p" inputmode="decimal" required value="${String(Number(prefs().percentualComissao) || 1).replace('.', ',')}">
    <div class="aviso">Você ainda pode mudar o percentual em cada venda.</div>
    <div class="acoes"><button class="btn primary">Salvar</button></div></form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const p = C.parseValor(new FormData(ev.target).get('p'));
    if (!(p >= 0 && p <= 100)) { toast('Percentual inválido'); return; }
    salvarPrefs({ percentualComissao: p }); fecharModal(); toast('Salvo');
  });
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
  ${modCom() ? relatorioComissoes() : ''}
  <div class="sec">${heatmap()}</div>`;
}

function relatorioComissoes() {
  const serie = C.serieComissoes(D, ym, 6);
  const max = Math.max(1, ...serie.map((s) => s.valor));
  const total = serie.reduce((t, s) => t + s.valor, 0);
  const rank = (campo, icone) => {
    const l = C.rankingComissoes(D, campo).slice(0, 5);
    if (!l.length) return '<div class="sub">Sem vendas ainda.</div>';
    const top = l[0][1] || 1;
    return l.map(([k, v]) => `<div class="cat" style="padding:10px 0;border:0">
      <div class="cat-top" style="display:flex;justify-content:space-between;font-size:.88rem"><span>${icone} ${esc(k)}</span><b>${fmt(v)}</b></div>
      <div class="barra" style="margin-top:6px;height:6px"><div style="width:${Math.round((v / top) * 100)}%;background:linear-gradient(90deg,#fbbf24,#ff7a45)"></div></div></div>`).join('');
  };
  return `
  <div class="card g"><div class="lbl">💼 Comissões recebidas · 6 meses</div><div class="val pos">${fmt(total)}</div>
    <div class="bars">${serie.map((s) => `<div class="col ${s.ym === ym ? 'atual' : ''}"><div class="pair">
      <i style="width:55%;max-width:26px;height:${(s.valor / max) * 100}%;background:linear-gradient(180deg,#fbbf24,#ff7a45)" title="${fmt(s.valor)}"></i></div>
      <span>${C.nomeMes(s.ym, true)}</span></div>`).join('')}</div></div>
  <div class="card g"><div class="lbl">Comissão por empresa</div>${rank('empresa', '🏢')}</div>
  <div class="card g"><div class="lbl">Comissão por produto</div>${rank('produto', '📦')}</div>`;
}

// ---------------- Modais ----------------
function abrirModal(titulo, html) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = html;
  $('#modal').classList.remove('hidden');
  const primeiro = $('#modal-corpo input:not([type=checkbox]):not([type=radio])');
  if (primeiro && window.matchMedia('(pointer: fine)').matches) primeiro.focus();
}
const fecharModal = () => $('#modal').classList.add('hidden');
const dataPadrao = () => (ym === C.ymAtual() ? C.hojeISO() : C.periodo(ym)[0]);
const optsCategorias = (sel) => [...new Set([...C.listaCategorias(), ...(sel ? [sel] : [])])].map((k) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${C.catInfo(k).e} ${esc(k)}</option>`).join('');
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
    ${modCom() ? '<button data-a="nova-comissao" style="grid-column:1/-1"><span>💼</span><b>Venda / comissão</b><small>Registrar uma venda fechada</small></button>' : ''}
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
      const recId = store.novoId(); const mes = C.mesDe(dados.data);
      store.definir('recorrentes', recId, { tipo: 'conta', descricao: dados.descricao, valor, categoria: dados.categoria, carteiraId, dia: Number(dados.data.slice(8, 10)), inicio: mes, fim: null });
      store.definir('contas', `${recId}_${mes}`, { ...dados, recorrenteId: recId });
      geradosNestaSessao.add(`${recId}_${mes}`);
    } else if (novo) store.adicionar('contas', dados);
    else store.atualizar('contas', c.id, dados);
    fecharModal();
    toast(C.mesDe(dados.data) !== ym ? `Salva em ${C.rotuloMes(C.mesDe(dados.data))}` : novo ? 'Conta adicionada' : 'Conta atualizada');
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
      const recId = store.novoId(); const mes = C.mesDe(dados.data);
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
      <label>Saldo inicial</label>
      <div class="seg" style="margin-bottom:8px">
        <label><input type="radio" name="sinal" value="1" ${Number(c.saldoInicial || 0) >= 0 ? 'checked' : ''}>➕ Positivo</label>
        <label><input type="radio" name="sinal" value="-1" ${Number(c.saldoInicial || 0) < 0 ? 'checked' : ''}>➖ Negativo (devendo)</label>
      </div>
      <input name="saldoInicial" inputmode="decimal" placeholder="0,00" value="${Math.abs(Number(c.saldoInicial || 0)).toFixed(2).replace('.', ',')}">
      <div class="aviso">Quanto havia nesta conta ao começar a usar o app. Use <b>Negativo</b> se a conta está no cheque especial ou com saldo devedor. Entradas, contas pagas e transferências ligadas a ela atualizam o saldo, que também pode ficar negativo.</div>
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
      // Aceita o sinal pelo seletor ou digitado ("-1.200,00").
      const v = C.parseValor(f.get('saldoInicial')) || 0;
      dados.saldoInicial = C.r2(Math.abs(v) * (v < 0 || f.get('sinal') === '-1' ? -1 : 1));
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
  const livres = C.listaCategorias().filter((k) => !usados.has(k) || (o && o.categoria === k));
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

function atualizarOlho() {
  $('#btn-olho').innerHTML = ocultar ? ICON_OLHO_OFF : ICON_OLHO;
}

function mudarMes(n) {
  ym = C.somarMes(ym, n);
  gerarRecorrentes();
  render();
  $('#conteudo').classList.remove('fade-in'); void $('#conteudo').offsetWidth; $('#conteudo').classList.add('fade-in');
}

// ---------------- Conta ----------------
function linhaConta(acao, ic, cor, titulo, direita = '<span class="seta">›</span>', extra = '') {
  return `<div class="row clic ${extra}" data-a="${acao}"><div class="ic" style="--c:${cor}">${ic}</div>
    <div class="info"><div class="t">${titulo}</div></div>${direita}</div>`;
}

function telaConta() {
  const lk = L.config();
  const p = prefs();
  const tempo = lk ? (lk.minutos === 0 ? 'ao sair do app' : `após ${lk.minutos ?? 1} min`) : '';
  const nCats = (p.categorias || []).length;
  const ocAbrir = localStorage.getItem('fin-ocultar-abrir') === '1';
  const seta = (txt) => `<span class="val-d">${txt}</span><span class="seta">›</span>`;
  return `
  <div class="card g perfil">
    <div class="avatar">${avatarHTML()}</div>
    <div style="min-width:0">
      <div class="nome">${esc(usuario.displayName || 'Você')}</div>
      <div class="mail">${esc(usuario.email || '')}</div>
      <div class="via">${modoLocal ? '🧪 Modo local de teste' : '<b style="color:#fff">G</b> Conectado com Google'}</div>
    </div>
  </div>

  <div class="sec"><div class="sec-h"><h3>Segurança</h3></div><div class="list g">
    ${linhaConta('cfg-bloqueio', '🔒', '#a78bfa', 'Bloqueio do app', seta(lk ? (lk.credId ? 'PIN + biometria' : 'PIN') : 'Desligado'))}
    ${lk ? linhaConta('cfg-tempo', '⏱️', '#60a5fa', 'Bloquear', seta(tempo)) : ''}
    ${linhaConta('cfg-ocultar', '👁️', '#22d3ee', 'Ocultar valores ao abrir', `<span class="sw ${ocAbrir ? 'on' : ''}"></span>`)}
    <a class="row clic" href="https://myaccount.google.com/security" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
      <div class="ic" style="--c:#4ade80">🛡️</div><div class="info"><div class="t">Senha e segurança da conta Google</div></div><span class="seta">↗</span></a>
  </div></div>

  <div class="sec"><div class="sec-h"><h3>Preferências</h3></div><div class="list g">
    ${linhaConta('cfg-apelido', '👋', '#facc15', 'Como quer ser chamado', seta(esc(p.apelido || (usuario.displayName || '').split(' ')[0] || '—')))}
    ${linhaConta('cfg-inicio', '📅', '#ff8a4c', 'Início do mês financeiro', seta(`Dia ${C.diaInicio()}`))}
    ${linhaConta('cfg-categorias', '🏷️', '#f472b6', 'Categorias', seta(nCats ? `${nCats} ${nCats === 1 ? 'personalizada' : 'personalizadas'}` : 'Padrão'))}
    ${linhaConta('recorrencias', '🔁', '#818cf8', 'Recorrências', seta(String(D.recorrentes.filter((r) => !r.fim || r.fim >= C.ymAtual()).length)))}
  </div></div>

  <div class="sec"><div class="sec-h"><h3>Módulos</h3></div><div class="list g">
    ${linhaConta('cfg-mod-comissoes', '💼', '#fbbf24', 'Comissões de vendas', `<span class="sw ${modCom() ? 'on' : ''}"></span>`)}
    ${modCom() ? linhaConta('cfg-percentual', '％', '#fbbf24', 'Comissão padrão', seta(`${String(Number(p.percentualComissao) || 1).replace('.', ',')}%`)) : ''}
  </div></div>

  <div class="sec"><div class="sec-h"><h3>Seus dados</h3></div><div class="list g">
    ${linhaConta('exportar-csv', '📊', '#4ade80', 'Exportar planilha (Excel)')}
    ${linhaConta('exportar', '💾', '#60a5fa', 'Exportar backup completo')}
    ${linhaConta('importar', '📥', '#2dd4bf', 'Importar backup')}
    ${linhaConta('apagar-tudo', '🗑️', '#fb7185', 'Apagar todos os dados', '<span class="seta">›</span>', 'perigo')}
  </div></div>

  <div class="sec"><div class="list g">
    ${linhaConta('sair', '↪️', '#a1a1aa', 'Sair da conta', '')}
    ${linhaConta('excluir-conta', '⚠️', '#fb7185', 'Excluir conta', '', 'perigo')}
  </div></div>

  <div class="rodape">Minhas Finanças · versão ${VERSAO}<br>${esc(syncStatus)}</div>`;
}

function configApelido() {
  abrirModal('Como quer ser chamado', `<form id="f">
    <label>Nome na saudação</label><input name="apelido" maxlength="30" placeholder="${esc((usuario.displayName || '').split(' ')[0])}" value="${esc(prefs().apelido || '')}">
    <div class="acoes"><button class="btn primary">Salvar</button></div></form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    salvarPrefs({ apelido: new FormData(ev.target).get('apelido').trim() });
    fecharModal(); toast('Salvo');
  });
}

function configInicio() {
  abrirModal('Início do mês financeiro', `<form id="f">
    <div class="aviso" style="margin-top:4px">Se seu salário cai no dia 5, por exemplo, use <b>dia 5</b>: o "mês de novembro" vai de 05/11 a 04/12, e o resumo, os orçamentos e as recorrências seguem esse período.</div>
    <label>Dia em que o mês começa</label><input name="dia" type="number" min="1" max="28" required value="${C.diaInicio()}">
    <div class="aviso" id="prev-dia"></div>
    <div class="acoes"><button class="btn primary">Salvar</button></div></form>`);
  const form = $('#f');
  const prev = () => {
    const d = Math.min(28, Math.max(1, Number(new FormData(form).get('dia')) || 1));
    const atual = C.diaInicio();
    C.configurar({ ...prefs(), diaInicio: d });
    const m = C.ymAtual(); const [i, f] = C.periodo(m);
    $('#prev-dia').innerHTML = `Mês atual: <b>${C.nomeMes(m)}</b>, de ${C.dataBR(i)} a ${C.dataBR(f)}`;
    C.configurar({ ...prefs(), diaInicio: atual });
  };
  form.addEventListener('input', prev); prev();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const d = Math.min(28, Math.max(1, Number(new FormData(form).get('dia')) || 1));
    salvarPrefs({ diaInicio: d });
    fecharModal(); toast(`O mês agora começa no dia ${d}`);
  });
}

function configCategorias() {
  const extras = prefs().categorias || [];
  abrirModal('Categorias', `
    ${extras.length ? `<div class="list g">${extras.map((c, i) => `<div class="row">
      <div class="ic" style="--c:${c.c}">${esc(c.e)}</div><div class="info"><div class="t">${esc(c.nome)}</div></div>
      <button class="btn danger" style="flex:0;padding:8px 12px;font-size:.8rem" data-del-cat="${i}">Remover</button></div>`).join('')}</div>`
      : '<div class="aviso" style="margin-top:4px">Você ainda não criou categorias. As padrão são: ' + C.listaCategorias().join(', ') + '.</div>'}
    <form id="f">
      <div class="lbl-f" style="margin-top:22px;font-weight:600;color:var(--text)">Nova categoria</div>
      <div class="linha">
        <div style="flex:0 0 76px"><label>Ícone</label><input name="e" maxlength="4" value="🏷️" style="text-align:center;font-size:1.3rem"></div>
        <div><label>Nome</label><input name="nome" required maxlength="24" placeholder="Ex.: Pets, Filhos, Beleza"></div>
      </div>
      <label>Cor</label>
      <div class="cores">${C.CORES.map((k, i) => `<label style="background:${k}"><input type="radio" name="c" value="${k}" ${i === 2 ? 'checked' : ''}></label>`).join('')}</div>
      <div class="acoes"><button class="btn primary">Adicionar</button></div>
    </form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const nome = f.get('nome').trim();
    if (C.listaCategorias().some((k) => k.toLowerCase() === nome.toLowerCase())) { toast('Essa categoria já existe'); return; }
    salvarPrefs({ categorias: [...extras, { nome, e: f.get('e').trim() || '🏷️', c: f.get('c') || C.CORES[2] }] });
    toast(`Categoria "${nome}" criada`);
    setTimeout(configCategorias, 150);
  });
  $$('#modal-corpo [data-del-cat]').forEach((b) => b.addEventListener('click', () => {
    salvarPrefs({ categorias: extras.filter((_, i) => i !== Number(b.dataset.delCat)) });
    toast('Categoria removida. Lançamentos antigos continuam com o nome.');
    setTimeout(configCategorias, 150);
  }));
}

// ----- Bloqueio -----
let pinDigitado = '';
let escondidoEm = null;

function desenharPin() {
  const n = L.config()?.pinLen || 4;
  $('#pin-dots').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pinDigitado.length ? 'on' : ''}"></i>`).join('');
}
function travar() {
  const c = L.config(); if (!c) return;
  pinDigitado = ''; desenharPin();
  $('#lock-msg').textContent = c.credId ? 'Use a biometria ou digite seu PIN' : 'Digite seu PIN';
  $('#pin-bio').style.visibility = c.credId ? 'visible' : 'hidden';
  document.body.classList.add('travado');
  $('#lock').classList.remove('hidden');
  fecharModal();
  if (c.credId) tentarBio(true);
}
function destravar() {
  document.body.classList.remove('travado');
  $('#lock').classList.add('hidden');
  pinDigitado = '';
}
async function tentarBio(auto) {
  try { if (await L.verificarBio()) destravar(); } catch (e) { if (!auto) $('#lock-msg').textContent = 'Biometria não confirmada. Use o PIN.'; }
}
async function teclaPin(k) {
  const c = L.config(); if (!c) return;
  if (k === 'bio') { tentarBio(false); return; }
  if (k === 'del') { pinDigitado = pinDigitado.slice(0, -1); desenharPin(); return; }
  if (pinDigitado.length >= c.pinLen) return;
  pinDigitado += k; desenharPin();
  if (pinDigitado.length < c.pinLen) return;
  if (await L.conferePin(pinDigitado)) { destravar(); return; }
  const d = $('#pin-dots'); d.classList.remove('erro'); void d.offsetWidth; d.classList.add('erro');
  $('#lock-msg').textContent = 'PIN incorreto';
  pinDigitado = ''; setTimeout(desenharPin, 400);
}

function formNovoPin(titulo, aoSalvar) {
  abrirModal(titulo, `<form id="f">
    <label>Novo PIN (4 a 6 números)</label><input name="p1" class="pin-in" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required autocomplete="off">
    <label>Repita o PIN</label><input name="p2" class="pin-in" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required autocomplete="off">
    <label class="chk-l hidden" id="l-bio"><input type="checkbox" name="bio" checked> Desbloquear também com biometria (digital / Face ID)</label>
    <div class="aviso">O bloqueio vale só para este aparelho. Se esquecer o PIN, basta sair e entrar de novo com o Google.</div>
    <div class="acoes"><button class="btn primary">Ativar</button></div></form>`);
  L.bioDisponivel().then((ok) => { if (ok) $('#l-bio')?.classList.remove('hidden'); else { const cb = $('#f [name=bio]'); if (cb) cb.checked = false; } });
  $('#f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const p1 = f.get('p1'); const p2 = f.get('p2');
    if (!/^\d{4,6}$/.test(p1)) { toast('Use de 4 a 6 números'); return; }
    if (p1 !== p2) { toast('Os PINs não conferem'); return; }
    const cfg = { ...(await L.criarPin(p1)), minutos: L.config()?.minutos ?? 1 };
    if (f.get('bio') === 'on') {
      try { cfg.credId = await L.criarBio(usuario.email || usuario.displayName); } catch (e) { toast('Biometria não ativada; ficou só o PIN'); }
    }
    aoSalvar(cfg);
  });
}

function configBloqueio() {
  const c = L.config();
  if (!c) {
    formNovoPin('Ativar bloqueio', (cfg) => { L.salvar(cfg); fecharModal(); render(); toast(cfg.credId ? '🔒 Bloqueio com PIN e biometria ativado' : '🔒 Bloqueio com PIN ativado'); });
    return;
  }
  abrirModal('Bloqueio do app', `<form id="f">
    <div class="aviso" style="margin-top:4px">Ativo neste aparelho: <b>${c.credId ? 'PIN + biometria' : 'PIN'}</b>. Confirme seu PIN atual para alterar.</div>
    <label>PIN atual</label><input name="pin" class="pin-in" type="password" inputmode="numeric" maxlength="6" required autocomplete="off">
    <div class="acoes" style="flex-direction:column">
      <button type="button" class="btn" data-op="trocar">Trocar PIN</button>
      <button type="button" class="btn" data-op="bio">${c.credId ? 'Remover biometria' : 'Ativar biometria'}</button>
      <button type="button" class="btn danger" data-op="off">Desligar bloqueio</button>
    </div></form>`);
  $$('#modal-corpo [data-op]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await L.conferePin($('#f [name=pin]').value))) { toast('PIN incorreto'); return; }
    const op = b.dataset.op;
    if (op === 'off') { L.salvar(null); fecharModal(); render(); toast('Bloqueio desligado'); }
    if (op === 'trocar') formNovoPin('Trocar PIN', (cfg) => { L.salvar(cfg); fecharModal(); render(); toast('PIN alterado'); });
    if (op === 'bio') {
      const novo = { ...c };
      if (c.credId) delete novo.credId;
      else {
        if (!(await L.bioDisponivel())) { toast('Este aparelho não tem biometria disponível'); return; }
        try { novo.credId = await L.criarBio(usuario.email || usuario.displayName); } catch (e) { toast('Biometria não ativada'); return; }
      }
      L.salvar(novo); fecharModal(); render(); toast(novo.credId ? 'Biometria ativada' : 'Biometria removida');
    }
  }));
}

function configTempo() {
  const c = L.config(); if (!c) return;
  const ops = [[0, 'Na hora'], [1, '1 min'], [5, '5 min'], [15, '15 min']];
  abrirModal('Bloquear o app', `<form id="f">
    <label>Pedir PIN/biometria depois que o app ficar em segundo plano por</label>
    <div class="seg">${ops.map(([v, t]) => `<label><input type="radio" name="m" value="${v}" ${(c.minutos ?? 1) === v ? 'checked' : ''}>${t}</label>`).join('')}</div>
    <div class="acoes"><button class="btn primary">Salvar</button></div></form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    L.salvar({ ...c, minutos: Number(new FormData(ev.target).get('m')) });
    fecharModal(); render(); toast('Salvo');
  });
}

// ----- Dados -----
function baixar(nome, conteudo, tipo) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportarCSV() {
  const dBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
  const num = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
  const nomeC = (id) => carteira(id)?.nome || '';
  const linhas = [];
  C.vis(D.contas).forEach((c) => linhas.push([c.data, 'Conta a pagar', c.descricao, c.categoria || 'Outros', num(-c.valor), c.pago ? `Paga em ${dBR(c.pagoEm)}` : 'Em aberto', nomeC(c.carteiraId), '']));
  C.vis(D.entradas).forEach((e) => linhas.push([e.data, 'Entrada', e.descricao, '', num(e.valor), 'Recebida', nomeC(e.carteiraId), '']));
  D.compras.forEach((p) => linhas.push([p.data, 'Compra no cartão', p.descricao, p.categoria || 'Outros', num(-p.valor), '', nomeC(p.carteiraId), p.parcelas > 1 ? `${p.parcelas}x` : 'À vista']));
  D.transferencias.forEach((t) => linhas.push([t.data, 'Transferência', `${nomeC(t.de)} → ${nomeC(t.para)}`, '', num(t.valor), '', '', '']));
  // Comissões (uma linha por parcela). Parcelas recebidas também aparecem como "Entrada".
  C.parcelasComissao(D, { incluirCanceladas: true }).forEach((p) => linhas.push([
    p.data, 'Comissão', `${p.com.empresa}${p.com.produto ? ' — ' + p.com.produto : ''} (venda ${dBR(p.com.dataVenda)}: ${num(p.com.valorVenda)})`, '', num(p.valor),
    p.com.cancelada ? 'Venda cancelada' : p.recebido ? `Recebida em ${dBR(p.recebidoEm)}` : 'A receber', nomeC(p.carteiraId), p.n > 1 ? `${p.i + 1}/${p.n}` : '',
  ]));
  linhas.sort((a, b) => a[0].localeCompare(b[0]));
  const cab = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor (R$)', 'Situação', 'Conta/Cartão', 'Parcelas'];
  const cel = (s) => (/[;"\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const csv = [cab, ...linhas.map((l) => [dBR(l[0]), ...l.slice(1)])].map((l) => l.map(cel).join(';')).join('\r\n');
  baixar(`financas-${C.hojeISO()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  toast(`${linhas.length} lançamentos exportados`);
}

async function exportar() {
  const dados = await store.exportarTudo();
  baixar(`financas-backup-${C.hojeISO()}.json`, JSON.stringify(dados, null, 2), 'application/json');
}

function importar() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const arq = inp.files[0]; if (!arq) return;
    let dados;
    try { dados = JSON.parse(await arq.text()); } catch (e) { toast('Arquivo inválido'); return; }
    const itens = [];
    for (const col of COLECOES) {
      const v = dados[col];
      if (!v) continue;
      const pares = Array.isArray(v) ? v.map(({ id, ...r }) => [id, r]) : Object.entries(v);
      pares.forEach(([id, r]) => { if (id && r && typeof r === 'object') itens.push([col, id, r]); });
    }
    if (!itens.length) { toast('Nenhum dado encontrado no arquivo'); return; }
    abrirModal('Importar backup', `<div class="aviso" style="margin-top:4px">Encontrei <b>${itens.length}</b> registros em <b>${esc(arq.name)}</b>. Itens que já existem com o mesmo identificador serão substituídos; o resto fica como está.</div>
      <div class="acoes"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Importar</button></div>`);
    $('#modal-corpo [data-x]').onclick = fecharModal;
    $('#modal-corpo [data-ok]').onclick = () => {
      itens.forEach(([col, id, r]) => store.definir(col, id, r));
      fecharModal(); toast(`${itens.length} registros importados`);
    };
  };
  inp.click();
}

function confirmarDigitando(titulo, aviso, palavra, botao, acao) {
  abrirModal(titulo, `<form id="f">
    <div class="aviso" style="margin-top:4px">${aviso}</div>
    <button type="button" class="btn big" data-a="exportar">💾 Baixar backup antes</button>
    <label>Para confirmar, digite <b>${palavra}</b></label><input name="w" autocomplete="off" autocapitalize="characters">
    <div class="acoes"><button class="btn danger">${botao}</button></div></form>`);
  $('#f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (new FormData(ev.target).get('w').trim().toUpperCase() !== palavra) { toast(`Digite ${palavra} para confirmar`); return; }
    const b = ev.target.querySelector('.btn.danger'); b.disabled = true; b.textContent = 'Aguarde…';
    try { await acao(); } catch (e) { b.disabled = false; b.textContent = botao; toast('Não foi possível concluir: ' + (e.code || e.message)); }
  });
}

function apagarTudo() {
  confirmarDigitando('Apagar todos os dados', 'Isso apaga <b>todas</b> as contas, entradas, cartões, metas, orçamentos e preferências desta conta, em todos os aparelhos. <b>Não dá para desfazer.</b>', 'APAGAR', 'Apagar tudo', async () => {
    apagando = true;
    try { await store.apagarTudo(); } finally { apagando = false; }
    geradosNestaSessao.clear();
    fecharModal(); trocarTela('inicio'); toast('Todos os dados foram apagados');
  });
}

function excluirConta() {
  confirmarDigitando('Excluir conta', 'Isso apaga todos os seus dados e remove sua conta do app. Sua conta Google não é afetada. <b>Não dá para desfazer.</b> O Google pode pedir para você confirmar o login.', 'EXCLUIR', 'Excluir minha conta', async () => {
    apagando = true;
    try { await store.apagarTudo(); await store.excluirConta(); } finally { apagando = false; }
    L.salvar(null);
    fecharModal(); toast('Conta excluída');
  });
}

// ---------------- Eventos ----------------
const ACOES = {
  hoje: () => { if (ym !== C.ymAtual()) { ym = C.ymAtual(); mudarMes(0); } },
  recorrencias: gerenciarRecorrencias,
  exportar: () => exportar(),
  'exportar-csv': () => exportarCSV(),
  importar: () => importar(),
  'apagar-tudo': () => apagarTudo(),
  'excluir-conta': () => excluirConta(),
  sair: () => store.sair(),
  'cfg-bloqueio': () => configBloqueio(),
  'cfg-tempo': () => configTempo(),
  'cfg-ocultar': () => {
    const on = localStorage.getItem('fin-ocultar-abrir') !== '1';
    localStorage.setItem('fin-ocultar-abrir', on ? '1' : '0'); render();
  },
  'cfg-mod-comissoes': () => {
    const on = !modCom();
    salvarPrefs({ modComissoes: on });
    toast(on ? '💼 Módulo de comissões ativado. Veja em Contas → Comissões' : 'Módulo de comissões desligado (seus dados continuam salvos)');
  },
  'cfg-percentual': () => configPercentual(),
  'nova-comissao': () => formComissao(),
  'editar-comissao': (id) => { const x = D.comissoes.find((c) => c.id === id); if (x) formComissao(x); },
  receber: (id, el) => receberComissao(id, Number(el.dataset.i)),
  'ir-comissoes': () => { sub = 'comissoes'; trocarTela('lanc'); },
  'cfg-apelido': () => configApelido(),
  'cfg-inicio': () => configInicio(),
  'cfg-categorias': () => configCategorias(),
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
    if (!el) return;
    const fn = ACOES[el.dataset.a];
    if (fn) { e.preventDefault(); fn(el.dataset.id, el); }
  });
  $$('.dock [data-tela]').forEach((b) => b.addEventListener('click', () => trocarTela(b.dataset.tela)));
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-filtro-emp]')) { filtroEmpresa = e.target.value; render(); }
  });
  $('#mes-ant').addEventListener('click', () => mudarMes(-1));
  $('#mes-prox').addEventListener('click', () => mudarMes(1));
  $('#btn-olho').addEventListener('click', () => {
    ocultar = !ocultar; localStorage.setItem('fin-ocultar', ocultar ? '1' : '0');
    atualizarOlho(); render();
  });
  // Bloqueio
  $$('#lock [data-pin]').forEach((b) => b.addEventListener('click', () => teclaPin(b.dataset.pin)));
  $('#lock-sair').addEventListener('click', () => { L.salvar(null); destravar(); store.sair(); });
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('travado')) return;
    if (/^\d$/.test(e.key)) teclaPin(e.key);
    else if (e.key === 'Backspace') teclaPin('del');
  });
  document.addEventListener('visibilitychange', () => {
    const c = L.config();
    if (!c || !usuario) return;
    if (document.hidden) escondidoEm = Date.now();
    else if (escondidoEm && Date.now() - escondidoEm >= (c.minutos ?? 1) * 60000) travar();
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
