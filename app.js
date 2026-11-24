import { criarStore, modoLocal, COLECOES } from './store.js?v=3.8';
import * as C from './calc.js?v=3.8';
import * as P from './planos.js?v=3.8';
import * as L from './lock.js?v=3.8';
import { interpretar, marcar } from './parser.js?v=3.8';
import { icone } from './icons.js?v=3.8';

const VERSAO = '3.8';

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
let diaSel = null;
let dicasAbertas = false;
document.addEventListener('toggle', (e) => { if (e.target.matches && e.target.matches('details.dicas')) dicasAbertas = e.target.open; }, true);
const salvarPrefs = (mud) => { const { id, ...atual } = prefs(); store.definir('config', 'prefs', { ...atual, ...mud }); };
let paradas = [];
const geradosNestaSessao = new Set();
let ultimoHero = null;

const fmt = (v) => (ocultar ? 'R$ ••••' : brl.format(Number(v) || 0));
const fmtCurto = (v) => (ocultar ? '••' : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v || 0));

const ICON_OLHO = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_OLHO_OFF = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>';

// desfazer: função opcional; mostra o botão "Desfazer" por 5 s.
function toast(msg, desfazer) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  if (desfazer) {
    const b = document.createElement('button');
    b.className = 'toast-btn'; b.textContent = 'Desfazer';
    b.onclick = () => { desfazer(); t.classList.add('hidden'); };
    t.append(b);
  }
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), desfazer ? 5000 : 2400);
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
  setTimeout(abrirAtalho, 1500);
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
  paradas.push(ouvirConexoes());
  // Link de convite para dividir contas (?convite=código).
  const conv = new URLSearchParams(location.search).get('convite');
  if (conv) {
    const u = new URL(location.href); u.searchParams.delete('convite'); history.replaceState(null, '', u);
    setTimeout(() => abrirConvite(conv.toLowerCase()), 1800);
  }
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
  if (apagando || !srv.contas || !srv.entradas || !srv.recorrentes || !srv.config || !srv.compras) return;
  C.configurar(prefs());
  // O mês anterior também entra: a assinatura cobrada nele cai na fatura do mês aberto.
  for (const mes of new Set([C.somarMes(ym, -1), ym, C.ymAtual()])) {
    for (const r of D.recorrentes) {
      if (!r.inicio || r.inicio > mes || (r.fim && mes > r.fim)) continue;
      if (r.tipo === 'compra' && !carteira(r.carteiraId)) continue;
      const id = `${r.id}_${mes}`;
      const col = r.tipo === 'entrada' ? 'entradas' : r.tipo === 'compra' ? 'compras' : 'contas';
      if (D[col].some((x) => x.id === id) || geradosNestaSessao.has(id)) continue;
      geradosNestaSessao.add(id);
      const desc = r.financiamento ? `${r.descricao} · parcela ${(Number(r.parcelaInicial) || 1) + P.mesesEntre(r.inicio, mes)}/${r.totalParcelas}` : r.descricao;
      const doc = { descricao: desc, valor: r.valor, data: C.dataNoPeriodo(mes, r.dia), recorrenteId: r.id, carteiraId: r.carteiraId || null };
      if (col === 'contas') Object.assign(doc, { categoria: r.categoria || 'Outros', pago: false, pagoEm: null });
      if (col === 'compras') Object.assign(doc, { categoria: r.categoria || 'Assinaturas', parcelas: 1 });
      store.definir(col, id, doc);
    }
  }
}

// ---------------- Render ----------------
function render() {
  C.configurar(prefs());
  $('#mes-label').textContent = C.rotuloMes(ym);
  $('#avatar').classList.toggle('ativo', tela === 'conta');
  // Subtelas acendem a aba de onde se chega nelas (navegação do redesign: Hoje, Movimentos, Planejar, Mais).
  const aba = { dividas: 'planejar', relatorios: 'mais', conta: 'mais', fluxo: 'mais', dividir: 'mais' }[tela] || tela;
  $$('.dock [data-tela]').forEach((b) => b.classList.toggle('active', b.dataset.tela === aba));
  const el = $('#conteudo');
  const html = { inicio: telaInicio, lanc: telaLanc, planejar: telaPlanejar, relatorios: telaRelatorios, conta: telaConta, dividas: telaDividas, fluxo: telaFluxo, dividir: telaDividir, mais: telaMais }[tela]();
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
    <div class="ic" style="--c:${ci.c}">${icone(ci.e)}</div>
    <div class="info" data-a="${fat ? 'ver-fatura' : 'editar-conta'}" data-id="${fat ? x.card.id : x.id}">
      <div class="t">${esc(x.descricao)}</div>
      <div class="m">${C.dataBR(x.data)}${fat ? ` · ${plural(x.itens.length, 'compra', 'compras')}${x.saldoAnterior > 0 ? ' · inclui atraso' : ''}${x.rolada ? ' · somada à próxima fatura' : ''}` : ''}${x.recorrenteId ? ' · 🔁' : ''}${x.parteOutro > 0 ? ' · 🤝' : ''}${cart ? ' · ' + esc(cart.nome) : ''} ${tagVenc(x)}</div>
    </div>
    <div class="v">${fmt(x.valor)}</div>
    <button class="chk ${x.pago ? 'on' : ''}" data-a="pagar" data-tipo="${x.tipo}" data-id="${x.id}" aria-label="${x.pago ? 'Desmarcar pagamento' : 'Marcar como pago'}">✓</button>
  </div>`;
}

// Lançamentos que contam como gasto num dia (mesma regra de C.gastosPorDia).
function gastosDoDia(iso) {
  const l = [];
  const dv = (x) => (x.parteOutro > 0 ? ' · 🤝 sua parte' : '');
  C.vis(D.contas).filter((c) => c.pago && c.pagoEm === iso).forEach((c) => l.push({ d: c.descricao, v: C.r2(c.valor * C.minhaFracao(c)), cat: c.categoria, o: 'conta paga' + dv(c) }));
  C.vis(D.compras).filter((p) => p.data === iso).forEach((p) => l.push({ d: p.descricao, v: C.r2(p.valor * C.minhaFracao(p)), cat: p.categoria, o: (carteira(p.carteiraId)?.nome || 'cartão') + (p.parcelas > 1 ? ` · ${p.parcelas}x` : '') + dv(p) }));
  divItens.filter((x) => x.data === iso && !(x.criadoPor === usuario.uid && x.lancado)).forEach((x) => {
    const v = C.minhaParteItem(x, usuario.uid);
    if (v > 0) l.push({ d: x.descricao, v, cat: x.categoria, o: `🤝 sua parte com ${nomeOutro()}` });
  });
  return l.sort((a, b) => b.v - a.v);
}

function heatmap() {
  const dias = C.gastosPorDia(D, ym);
  const lista = C.diasDoPeriodo(ym);
  const [a, m, d0] = lista[0].split('-').map(Number);
  const offset = new Date(a, m - 1, d0).getDay();
  const vals = Object.values(dias).filter((v) => v > 0).sort((x, y) => x - y);
  const q = (p) => vals[Math.floor((vals.length - 1) * p)] || 0;
  const nivel = (v) => (!(v > 0) ? '' : v <= q(.25) ? 'l1' : v <= q(.5) ? 'l2' : v <= q(.8) ? 'l3' : 'l4');
  const hoje = C.hojeISO();
  if (diaSel && !lista.includes(diaSel)) diaSel = null;
  let cells = '<i class="vz"></i>'.repeat(offset);
  for (const iso of lista) {
    cells += `<i class="${nivel(dias[iso])} ${iso === hoje ? 'hoje' : ''} ${iso === diaSel ? 'sel' : ''} ${iso > hoje ? 'fut' : ''}" data-a="dia" data-id="${iso}" title="${C.dataBR(iso)}: ${fmt(dias[iso] || 0)}"><b>${Number(iso.slice(8))}</b></i>`;
  }
  const soma = Object.values(dias).reduce((t, v) => t + v, 0);
  // Estatísticas do período (até hoje, se for o mês atual)
  const passados = lista.filter((d) => d <= hoje);
  const nDias = Math.max(1, passados.length || lista.length);
  const media = soma / nDias;
  const maior = Object.entries(dias).sort((x, y) => y[1] - x[1])[0];
  const semGasto = (passados.length ? passados : lista).filter((d) => !(dias[d] > 0)).length;
  // Comparação com o mesmo ponto do mês anterior
  const ant = C.gastosPorDia(D, C.somarMes(ym, -1));
  const listaAnt = C.diasDoPeriodo(C.somarMes(ym, -1)).slice(0, nDias);
  const somaAnt = listaAnt.reduce((t, d) => t + (ant[d] || 0), 0);
  const delta = somaAnt > 0 ? Math.round(((soma - somaAnt) / somaAnt) * 100) : null;
  // Dia da semana em que mais gasta
  const sem = [0, 0, 0, 0, 0, 0, 0];
  Object.entries(dias).forEach(([d, v]) => { const [y, mm, dd] = d.split('-').map(Number); sem[new Date(y, mm - 1, dd).getDay()] += v; });
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const iSem = sem.indexOf(Math.max(...sem));
  const det = diaSel ? gastosDoDia(diaSel) : [];
  return `<div class="card g heatcard">
    <div class="lbl">Gastos por dia · ${C.nomeMes(ym)}</div>
    <div class="val">${fmt(soma)} ${delta !== null ? `<span class="delta ${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs ${C.nomeMes(C.somarMes(ym, -1), true).toLowerCase()}</span>` : ''}</div>
    <div class="hstats">
      <div><span>Média/dia</span><b>${fmt(media)}</b></div>
      <div><span>Maior gasto</span><b>${maior ? `${fmt(maior[1])}` : '—'}</b><small>${maior ? C.dataBR(maior[0]) : ''}</small></div>
      <div><span>Dias sem gastar</span><b>${semGasto}</b><small>de ${passados.length || lista.length}</small></div>
    </div>
    <div class="heat-h"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
    <div class="heat">${cells}</div>
    <div class="heat-leg"><span>menos</span><i></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>mais</span>
      ${sem[iSem] > 0 ? `<em>Você gasta mais às ${nomes[iSem]}s</em>` : ''}</div>
    ${diaSel ? `<div class="dia-det">
      <div class="dia-h"><b>${C.dataBR(diaSel)}</b><span>${fmt(dias[diaSel] || 0)}</span></div>
      ${det.length ? det.map((x) => `<div class="dia-l"><span>${C.catInfo(x.cat).e} ${esc(x.d)}<small>${esc(x.o)}</small></span><b>${fmt(x.v)}</b></div>`).join('') : '<div class="sub">Nenhum gasto neste dia 🎉</div>'}
    </div>` : '<div class="sub" style="margin-top:10px">Toque num dia para ver o que foi gasto.</div>'}
  </div>`;
}

function cardSaude() {
  const s = C.saudeFinanceira(D, ym, fmt);
  const cor = { verde: '🟢', amarelo: '🟡', vermelho: '🔴' };
  return `<div class="card g saude s-${s.nivel}">
    <div class="saude-top">
      <div class="semaforo"><i class="r ${s.nivel === 'vermelho' ? 'on' : ''}"></i><i class="a ${s.nivel === 'amarelo' ? 'on' : ''}"></i><i class="v ${s.nivel === 'verde' ? 'on' : ''}"></i></div>
      <div style="flex:1;min-width:0"><div class="lbl">Saúde financeira · ${C.nomeMes(ym).toLowerCase()}</div><div class="val">${s.titulo}</div></div>
      <div class="nota"><b>${s.nota}</b><small>/100</small></div>
    </div>
    <div class="barra saude-barra"><div style="width:${s.nota}%"></div></div>
    <p class="saude-res">${s.resumo}</p>
    <div class="sinais">${s.sinais.map((x) => `<div class="sinal"><span>${cor[x.n]}</span><div><b>${esc(x.t)}</b><small>${esc(x.d)}</small></div></div>`).join('')}</div>
    ${s.nivel !== 'verde' ? '<button class="btn big" style="margin-top:10px;position:relative" data-a="ir" data-id="dividas">📉 Ver plano de saída das dívidas</button>' : ''}
    <details class="dicas" ${dicasAbertas ? 'open' : ''}><summary>💡 ${s.dicas.length} dicas para melhorar</summary>
      ${s.dicas.map((d) => `<div class="dica"><span>${d.e}</span><p>${esc(d.t)}</p></div>`).join('')}
    </details>
  </div>`;
}

function seletorMes(ano) {
  ano = ano || Number(ym.slice(0, 4));
  const atual = C.ymAtual();
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${C.pad(i + 1)}`);
  abrirModal('Escolher mês', `
    <div class="ano-nav"><button class="ico g" data-a="ano" data-id="${ano - 1}">‹</button><b>${ano}</b><button class="ico g" data-a="ano" data-id="${ano + 1}">›</button></div>
    <div class="mes-grid">${meses.map((m) => `<button class="${m === ym ? 'sel' : ''} ${m === atual ? 'atual' : ''}" data-a="escolher-mes" data-id="${m}">${C.nomeMes(m, true)}</button>`).join('')}</div>
    <button class="btn big" data-a="escolher-mes" data-id="${atual}">📅 Ir para o mês atual (${C.rotuloMes(atual).toLowerCase()})</button>`);
}

// ----- Início -----
function telaInicio() {
  const r = C.resumoMes(D, ym);
  const rc = modCom() ? C.resumoComissoes(D, ym) : null;
  const previsao = C.r2(r.previsao + (rc ? rc.previstoMes : 0));
  const p = P.projecao(D, 60, { comissoes: modCom() });
  const hoje = C.hojeISO();

  // Cor do valor: âmbar quando cai abaixo de 30% da média diária gasta no mês, vermelho quando acaba.
  const gastoDia = C.gastosPorDia(D, ym);
  const passados = C.diasDoPeriodo(ym).filter((d) => d <= hoje);
  const mediaDia = Object.values(gastoDia).reduce((t, v) => t + v, 0) / Math.max(1, passados.length);
  const corHero = p.podeGastar <= 0 ? 'neg' : mediaDia > 0 && p.podeGastar < mediaDia * 0.3 ? 'warn' : '';

  const nDias = p.prox ? Math.min(31, Math.max(1, C.diasAte(p.prox.d))) : 30;
  const diaSemana = (iso) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${iso}T12:00`).getDay()];
  const ateQuando = p.prox
    ? `Até ${esc(p.prox.t.toLowerCase())}, ${diaSemana(p.prox.d)} ${C.dataBR(p.prox.d)} · ${plural(nDias, 'dia', 'dias')}`
    : 'Nos próximos 30 dias';

  return `
  <button class="hero2" data-a="ir" data-id="fluxo">
    <span class="h2-lbl">Pode gastar hoje</span>
    <span class="h2-linha"><span class="hero-val ${corHero}" data-count="${p.podeGastar}">${fmt(p.podeGastar)}</span><span class="h2-suf">/dia</span></span>
    <span class="h2-sub">${ateQuando}</span>
    <span class="dias" style="grid-template-columns:repeat(${nDias},1fr)" aria-hidden="true">${'<i></i>'.repeat(nDias)}</span>
    <span class="dias-leg"><span>HOJE ${Number(hoje.slice(8))}</span><span>${p.prox ? `${esc(p.prox.t.toUpperCase())} ${C.dataBR(p.prox.d)}` : '+30 DIAS'}</span></span>
  </button>

  <div class="duo">
    <div class="mini-card"><span>Sobrou até agora</span><b class="${r.sobra < 0 ? 'neg' : ''}">${fmt(r.sobra)}</b></div>
    <div class="mini-card"><span>Fim do mês previsto</span><b class="${previsao < 0 ? 'neg' : ''}">${fmt(previsao)}</b></div>
  </div>

  ${precisaDeVoce(r, p, rc)}

  ${saudeCompacta()}`;
}

// "Precisa de você": só o que pede ação, na ordem de urgência (máx. 4 na Início).
function itensPendentes(r, p, rc) {
  const hoje = C.hojeISO();
  const quando = (d) => `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${d}T12:00`).getDay()]}, ${C.dataBR(d)}`;
  const l = [];
  C.emAtraso(D).forEach((x) => {
    const d = -C.diasAte(x.data);
    l.push({ cor: 'red', t: x.descricao, s: `Venceu há ${plural(d, 'dia', 'dias')}`, sCls: 'neg', v: x.valor, pagar: x, primario: true });
  });
  const vistos = new Set(l.map((x) => x.pagar.id));
  [...r.abertos, ...C.pagaveisMes(D, C.somarMes(C.ymAtual(), 1))]
    .filter((x) => !x.pago && !vistos.has(x.id) && C.diasAte(x.data) >= 0 && C.diasAte(x.data) <= 5)
    .sort((a, b) => a.data.localeCompare(b.data))
    .forEach((x) => { vistos.add(x.id); l.push({ cor: 'amber', t: x.descricao, s: C.diasAte(x.data) === 0 ? 'Vence hoje' : `Vence ${quando(x.data)}`, v: x.valor, pagar: x }); });
  C.cartoes(D).forEach((card) => {
    [C.ymAtual(), C.somarMes(C.ymAtual(), 1)].map((m) => C.faturaDe(D, card, m))
      .filter((f) => !f.pago && f.valor > 0 && f.fecha >= hoje && C.diasAte(f.fecha) <= 5)
      .slice(0, 1)
      .forEach((f) => {
        const pct = Number(card.limite) > 0 ? Math.round((C.limiteUsado(D, card) / Number(card.limite)) * 100) : null;
        l.push({ cor: 'muted', t: `${card.nome} fecha`, s: `Fecha ${C.dataBR(f.fecha)}${pct !== null ? ` · ${pct}% do limite` : ''}`, v: f.valor, acao: `data-a="ver-fatura" data-id="${card.id}"` });
      });
  });
  C.orcamentosMes(D, ym).filter((o) => o.pct >= 90).forEach((o) => {
    l.push({ cor: o.pct >= 100 ? 'red' : 'amber', t: `Orçamento de ${o.categoria}`, s: `${o.pct}% usado`, v: o.gasto, acao: 'data-a="ir" data-id="planejar"' });
  });
  if (p.min.s < 0) l.push({ cor: 'red', t: 'Saldo previsto negativo', s: `Chega a ${fmt(p.min.s)} em ${C.dataBR(p.min.d)}`, acao: 'data-a="ir" data-id="fluxo"' });
  // Módulos ativos entram só quando têm algo a dizer (item 09).
  if (rc && rc.previstoMes > 0) {
    const prox = [...rc.pendentes].sort((a, b) => a.data.localeCompare(b.data))[0];
    l.push({ cor: 'muted', t: 'Comissões a receber', s: prox ? `Próxima dia ${Number(prox.data.slice(8))}` : 'Neste mês', v: rc.previstoMes, acao: 'data-a="ir-comissoes"' });
  }
  const cx = conexao();
  if (cx) {
    const saldo = C.saldoDivisao(divItens, usuario.uid);
    if (saldo) l.push({ cor: 'muted', t: saldo > 0 ? `${nomeOutro(cx)} te deve` : `Você deve a ${nomeOutro(cx)}`, s: 'Dividir contas', v: Math.abs(saldo), acao: 'data-a="ir-dividir"' });
  }
  return l;
}

function linhaPendente(x) {
  const btn = x.pagar
    ? `<button class="pg ${x.primario ? 'primario' : ''}" data-a="pagar-pendente" data-tipo="${x.pagar.tipo}" data-id="${x.pagar.id}">Pagar</button>`
    : '<span class="seta">›</span>';
  const abre = x.acao || (x.pagar ? `data-a="${x.pagar.tipo === 'fatura' ? 'ver-fatura' : 'editar-conta'}" data-id="${x.pagar.tipo === 'fatura' ? x.pagar.card.id : x.pagar.id}"` : '');
  return `<div class="pend">
    <i class="bol ${x.cor}"></i>
    <div class="info" ${abre}><div class="t">${esc(x.t)}</div><div class="m ${x.sCls || ''}">${x.s}</div></div>
    ${x.v !== undefined ? `<div class="v">${fmt(x.v)}</div>` : ''}
    ${btn}
  </div>`;
}

function precisaDeVoce(r, p, rc) {
  const l = itensPendentes(r, p, rc);
  const prox = [...r.abertos].filter((x) => !x.pago).sort((a, b) => a.data.localeCompare(b.data))[0];
  return `<div class="sec">
    <div class="sec-h"><h3>Precisa de você</h3>${l.length ? `<span class="cont">${l.length}</span>` : ''}</div>
    ${l.length ? `<div class="list g">${l.slice(0, 4).map(linhaPendente).join('')}</div>
      ${l.length > 4 ? `<button class="link ver-tudo" data-a="pendentes">Ver tudo</button>` : ''}`
      : `<p class="vazio-txt">Nada pendente.${prox ? ` Próxima conta: ${esc(prox.descricao)} em ${C.dataBR(prox.data)}.` : ''}</p>`}
  </div>`;
}

function saudeCompacta() {
  const s = C.saudeFinanceira(D, ym, fmt);
  return `<button class="card g saude-mini s-${s.nivel}" data-a="saude">
    <span class="lbl">Saúde financeira</span>
    <span class="barra saude-barra"><span style="width:${s.nota}%"></span></span>
    <b>${s.nota} · ${esc(s.titulo)}</b>
  </button>`;
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
      ${f.saldoAnterior > 0 ? `<div class="cc-meta">Inclui ${fmt(f.saldoAnterior)} da fatura de ${C.nomeMes(f.mesAnterior).toLowerCase()} em atraso${f.jurosEst ? ` + ${fmt(f.jurosEst)} de juros estimados` : ''}</div>` : ''}
      ${f.rolada ? '<div class="cc-meta">⚠️ Não paga: o valor passa para a próxima fatura, com juros</div>' : ''}
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
  <div class="grid2" style="margin-top:12px">
    <button class="card g" data-a="ir" data-id="dividas"><span class="chev">›</span><div style="font-size:1.5rem">📉</div><div class="val" style="font-size:1rem;margin-top:8px">Plano das dívidas</div><div class="sub">Simulador e ordem de pagamento</div></button>
    <button class="card g" data-a="ir" data-id="fluxo"><span class="chev">›</span><div style="font-size:1.5rem">📆</div><div class="val" style="font-size:1rem;margin-top:8px">Fluxo de caixa</div><div class="sub">Saldo previsto em 60 dias</div></button>
  </div>
  <div class="sec">
    <div class="sec-h"><h3>Orçamentos de ${C.nomeMes(ym).toLowerCase()}</h3><button data-a="novo-orcamento">+ Novo</button></div>
    ${orc.length ? `<div class="list g">${orc.map((o) => {
      const ci = C.catInfo(o.categoria);
      const cls = o.pct >= 100 ? 'red' : o.pct >= 80 ? 'amber' : '';
      return `<div class="row" data-a="editar-orcamento" data-id="${o.id}" style="cursor:pointer;flex-wrap:wrap">
        <div class="ic" style="--c:${ci.c}">${icone(ci.e)}</div>
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
    return `<div class="row"><div class="ic" style="--c:${ci.c}">${icone(ci.e)}</div>
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

// ----- Mais (item 05): tudo que não é aba fica a no máximo 2 toques -----
function telaMais() {
  const ic = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const itens = [
    ['relatorios', 'Relatórios', 'Gastos por categoria, comparação com meses anteriores', ic('<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>'), 'data-a="ir" data-id="relatorios"'],
    ['fluxo', 'Fluxo de caixa', 'Saldo previsto dia a dia nos próximos 60 dias', ic('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'), 'data-a="ir" data-id="fluxo"'],
    ['dividas', 'Dívidas', 'Plano para sair das dívidas, passo a passo', ic('<path d="M3 7h18v10H3z"/><path d="M7 12h4"/>'), 'data-a="ir" data-id="dividas"'],
    ['dividir', 'Dividir contas', conexao() ? `Com ${esc(nomeOutro(conexao()))}` : 'Divida gastos com outra pessoa', ic('<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c1-3 3-5 6-5s5 2 6 5M14 15c3 0 5 2 6 5"/>'), 'data-a="ir-dividir"'],
    ...(modCom() ? [['comissoes', 'Comissões', 'Vendas e comissões a receber', ic('<path d="M4 7h16v12H4z"/><path d="M9 7V5h6v2"/>'), 'data-a="ir-comissoes"']] : []),
    ['conta', 'Perfil e configurações', 'Conta, bloqueio, Telegram, backup, módulos', ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'), 'data-a="ir" data-id="conta"'],
  ];
  return `<div class="sec" style="margin-top:18px"><div class="list g mais">${itens.map(([, t, d, i, a]) => `<button class="row" ${a}>
    <span class="mais-ic">${i}</span><span class="info"><span class="t">${t}</span><span class="m">${d}</span></span><span class="seta">›</span></button>`).join('')}</div></div>`;
}

// ----- Lançar em uma linha (item 02) -----
const ABAS_LANCAR = [['gasto', 'Gasto'], ['entrada', 'Entrada'], ['apagar', 'Conta a pagar'], ['transf', 'Transferir']];
function abrirLancar(aba = 'gasto') {
  if (aba === 'transf') { formTransf(); return; }
  const cats = optsCategorias('Outros');
  abrirModal('Lançar', `<div class="lz">
    <div class="seg" role="tablist">${ABAS_LANCAR.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === aba}" class="${k === aba ? 'on' : ''}" data-a="lancar-aba" data-id="${k}">${t}</button>`).join('')}</div>
    <div class="lz-campo"><div class="lz-espelho" aria-hidden="true"></div>
      <input id="lz-txt" autocomplete="off" spellcheck="false" aria-label="Escreva o lançamento" placeholder="${aba === 'entrada' ? '1.200 salário itaú' : aba === 'apagar' ? '119,90 internet 10/12' : '50 salgado nubank'}"></div>
    <div class="lz-grid">
      <label><span>Valor</span><input id="lz-valor" inputmode="decimal" placeholder="R$ 0,00"></label>
      <label><span>Onde</span><select id="lz-cart"><option value="">Escolha</option>${D.carteiras.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select><small id="lz-fat"></small></label>
      <label><span id="lz-cat-lbl">Categoria</span><select id="lz-cat">${cats}</select></label>
      <label><span>Data</span><input id="lz-data" type="date" value="${C.hojeISO()}"></label>
    </div>
    <p class="lz-impacto" id="lz-imp"></p>
    <div class="lz-btns"><button type="button" class="btn" data-a="novo-boleto">Ler boleto</button><button type="button" class="btn lz-ok" id="lz-ok" disabled>Lançar</button></div>
    <button type="button" class="link lz-full" data-a="form-completo">Formulário completo</button>
  </div>`);
  ligarLancar(aba);
}

function ligarLancar(aba) {
  const txt = $('#lz-txt'), esp = $('.lz-espelho'), ok = $('#lz-ok');
  const campos = { valor: $('#lz-valor'), cart: $('#lz-cart'), cat: $('#lz-cat'), data: $('#lz-data') };
  const mexido = {};  // campos que a pessoa ajustou à mão não são sobrescritos pela leitura do texto
  Object.entries(campos).forEach(([k, el]) => el.addEventListener('input', () => { mexido[k] = true; atualizar(false); }));
  let x = null;
  const lido = () => {
    const valor = C.parseValor(campos.valor.value);
    const cart = carteira(campos.cart.value) || null;
    let tipo = aba === 'entrada' ? 'entrada' : aba === 'apagar' ? 'apagar' : cart && cart.tipo === 'cartao' ? 'compra' : 'conta';
    return { tipo, valor, cart, categoria: campos.cat.value, data: campos.data.value, descricao: (x && !x.erro && x.descricao) || campos.cat.value, parcelas: (x && x.parcelas) || 1 };
  };
  function atualizar(doTexto = true) {
    if (doTexto) {
      x = txt.value.trim() ? interpretar(txt.value, D.carteiras) : null;
      esp.innerHTML = marcar(txt.value, x).map((p) => (p.c ? `<span class="${p.c}">${esc(p.t)}</span>` : esc(p.t))).join('');
      if (x && !x.erro) {
        if (!mexido.valor) campos.valor.value = x.valor.toFixed(2).replace('.', ',');
        if (!mexido.cart) campos.cart.value = x.cart ? x.cart.id : (aba === 'apagar' || aba === 'entrada' ? carteiraPadrao() || '' : campos.cart.value || carteiraPadrao() || '');
        if (!mexido.cat && aba !== 'entrada') campos.cat.value = x.categoria;
        if (!mexido.data) campos.data.value = x.data;
      } else if (!mexido.valor) campos.valor.value = '';  // texto sem valor: Lançar fica desativado
    }
    const l = lido();
    $('#lz-cat-lbl').textContent = mexido.cat ? 'Categoria' : 'Categoria · sugerida';
    const fat = l.cart && l.cart.tipo === 'cartao' && l.data ? C.parcelasDe({ data: l.data, valor: l.valor || 0, parcelas: 1 }, l.cart)[0] : null;
    $('#lz-fat').textContent = fat ? `fatura ${C.nomeMes(fat.ym, true).toLowerCase()}` : '';
    ok.disabled = !(l.valor > 0) || (aba !== 'entrada' && !l.cart);
    $('#lz-imp').innerHTML = l.valor > 0 ? impactoLancamento(l) : '';
  }
  txt.addEventListener('input', () => atualizar(true));
  txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) ok.click(); });
  ok.addEventListener('click', () => salvarLancamento(lido()));
  setTimeout(() => txt.focus(), 50);
  atualizar(true);
}

const docLancamento = (l) => {
  if (l.tipo === 'compra') return ['compras', { carteiraId: l.cart.id, descricao: l.descricao, valor: l.valor, data: l.data, parcelas: l.parcelas, categoria: l.categoria }];
  if (l.tipo === 'entrada') return ['entradas', { descricao: l.descricao === 'Outros' ? 'Entrada' : l.descricao, valor: l.valor, data: l.data, carteiraId: l.cart ? l.cart.id : null }];
  const pago = l.tipo === 'conta';
  return ['contas', { descricao: l.descricao, valor: l.valor, data: l.data, categoria: l.categoria, carteiraId: l.cart.id, pago, pagoEm: pago ? l.data : null }];
};

// "Depois disso, hoje cai de X para Y/dia", simulando o lançamento na projeção.
function impactoLancamento(l) {
  const op = { comissoes: modCom() };
  const antes = P.projecao(D, 60, op).podeGastar;
  const [col, doc] = docLancamento(l);
  const depois = P.projecao({ ...D, [col]: [...D[col], { ...doc, id: '_sim' }] }, 60, op).podeGastar;
  if (Math.abs(depois - antes) < 0.01) return 'Não muda o quanto você pode gastar hoje.';
  return `Depois disso, hoje ${depois < antes ? 'cai' : 'sobe'} de <b>${fmt(antes)}</b> para <b>${fmt(depois)}</b>/dia.`;
}

async function salvarLancamento(l) {
  const [col, doc] = docLancamento(l);
  const id = await store.adicionar(col, { ...doc, origem: 'app' });
  if (l.cart) localStorage.setItem('fin-ultima-carteira', l.cart.id);
  fecharModal();
  toast(`${doc.descricao} · ${fmt(doc.valor)} lançado`, () => store.remover(col, id));
}

function menuNovo() {
  abrirModal('Adicionar', `<div class="acao-grid">
    <button data-a="nova-conta"><span>🧾</span><b>Conta a pagar</b><small>Boleto, aluguel, luz…</small></button>
    <button data-a="nova-entrada"><span>💰</span><b>Entrada</b><small>Salário, Pix recebido…</small></button>
    <button data-a="nova-compra"><span>💳</span><b>Compra no cartão</b><small>À vista ou parcelada</small></button>
    <button data-a="novo-boleto"><span>🧾</span><b>Boleto</b><small>Cole ou escaneie o código</small></button>
    <button data-a="novo-financiamento"><span>🏠</span><b>Financiamento</b><small>Parcelas fixas mensais</small></button>
    <button data-a="importar-extrato" style="grid-column:1/-1"><span>📥</span><b>Importar extrato ou fatura</b><small>Arquivo CSV ou OFX do banco</small></button>
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
    <label>Descrição</label><input name="descricao" required maxlength="80" list="dl-hist" autocomplete="off" placeholder="Ex.: Aluguel, Luz, Internet" value="${esc(c.descricao)}">${datalistHistorico()}${c.codigo ? `<div class="aviso">🧾 Código do boleto: <code style="word-break:break-all">${esc(c.codigo)}</code><br><button type="button" class="btn" style="margin-top:8px;width:100%" data-a="copiar-codigo" data-id="${esc(c.codigo)}">Copiar código</button></div>` : ''}
    <div class="linha">
      <div><label>Vencimento</label><input name="data" type="date" required value="${c.data}"></div>
      <div><label>Categoria</label><select name="categoria">${optsCategorias(c.categoria)}</select></div>
    </div>
    ${C.contasBancarias(D).length ? `<label>Pagar com</label><select name="carteiraId">${optsCarteiras(c.carteiraId)}</select>` : ''}
    <label class="chk-l"><input type="checkbox" name="pago" ${c.pago ? 'checked' : ''}> Já está paga</label>
    ${novo ? '<label class="chk-l"><input type="checkbox" name="repetir"> Repetir todo mês</label>' : ''}
    ${blocoDividir(c)}
    ${blocoRecorrente(rec)}
    ${botoes(!novo)}
  </form>`);
  ligarSugestoes($('#f'));
  ligarDivisao($('#f'), () => ({ nome: nomeOutro(), euDevo: false }));
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const valor = lerValor(f); if (valor === null) return;
    const div = lerDividir(f, valor); if (div === false) return;
    const pago = f.get('pago') === 'on';
    const carteiraId = f.get('carteiraId') || null;
    if (carteiraId) localStorage.setItem('fin-ultima-carteira', carteiraId);
    const dados = { descricao: f.get('descricao').trim(), valor, data: f.get('data'), categoria: f.get('categoria'), carteiraId, pago, pagoEm: pago ? (c.pagoEm || C.hojeISO()) : null };
    const repetir = novo && f.get('repetir') === 'on';
    const recId = repetir ? store.novoId() : null; const mes = C.mesDe(dados.data);
    const id = repetir ? `${recId}_${mes}` : novo ? store.novoId() : c.id;
    // A divisão vale só para este lançamento (não para os próximos meses da recorrência).
    Object.assign(dados, camposDividir('contas', id, dados, novo ? null : c, div));
    if (repetir) {
      store.definir('recorrentes', recId, { tipo: 'conta', descricao: dados.descricao, valor, categoria: dados.categoria, carteiraId, dia: Number(dados.data.slice(8, 10)), inicio: mes, fim: null });
      store.definir('contas', id, { ...dados, recorrenteId: recId });
      geradosNestaSessao.add(id);
    } else if (novo) store.definir('contas', id, dados);
    else store.atualizar('contas', c.id, dados);
    fecharModal();
    toast(C.mesDe(dados.data) !== ym ? `Salva em ${C.rotuloMes(C.mesDe(dados.data))}` : novo ? 'Conta adicionada' : 'Conta atualizada');
  });
  ligarExcluir(() => { desfazerDivisao(c); return c.recorrenteId ? store.atualizar('contas', c.id, { excluida: true }) : store.remover('contas', c.id); });
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
    <label>Descrição</label><input name="descricao" required maxlength="80" list="dl-hist" autocomplete="off" placeholder="Ex.: Mercado, Tênis, iFood" value="${esc(cp.descricao)}">${datalistHistorico()}
    <div class="linha">
      <div><label>Data da compra</label><input name="data" type="date" required value="${cp.data}"></div>
      <div><label>Parcelas</label><select name="parcelas">${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}" ${i + 1 === Number(cp.parcelas) ? 'selected' : ''}>${i === 0 ? 'À vista' : `${i + 1}x`}</option>`).join('')}</select></div>
    </div>
    <div class="linha">
      <div><label>Cartão</label><select name="carteiraId">${cards.map((c) => `<option value="${c.id}" ${c.id === cp.carteiraId ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
      <div><label>Categoria</label><select name="categoria">${optsCategorias(cp.categoria)}</select></div>
    </div>
    ${novo ? '<label class="chk-l"><input type="checkbox" name="repetir"> Assinatura: repetir todo mês neste cartão</label>' : ''}
    <div class="aviso" id="prev-parc"></div>
    ${blocoDividir(cp)}
    ${blocoRecorrente(cp.recorrenteId ? D.recorrentes.find((r) => r.id === cp.recorrenteId) : null)}
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
  ligarSugestoes(form);
  ligarDivisao(form, () => ({ nome: nomeOutro(), euDevo: false }));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const valor = lerValor(f); if (valor === null) return;
    const div = lerDividir(f, valor); if (div === false) return;
    const dados = { descricao: f.get('descricao').trim(), valor, data: f.get('data'), parcelas: Number(f.get('parcelas')), carteiraId: f.get('carteiraId'), categoria: f.get('categoria') };
    if (novo && f.get('repetir') === 'on') {
      if (dados.parcelas > 1) { toast('Assinatura precisa ser à vista'); return; }
      const recId = store.novoId(); const mes = C.mesDe(dados.data);
      Object.assign(dados, camposDividir('compras', `${recId}_${mes}`, dados, null, div));
      store.definir('recorrentes', recId, { tipo: 'compra', descricao: dados.descricao, valor, categoria: dados.categoria, carteiraId: dados.carteiraId, dia: Number(dados.data.slice(8, 10)), inicio: mes, fim: null });
      store.definir('compras', `${recId}_${mes}`, { ...dados, recorrenteId: recId });
      geradosNestaSessao.add(`${recId}_${mes}`);
      fecharModal(); toast('🔁 Assinatura criada: lança todo mês neste cartão'); return;
    }
    const id = novo ? store.novoId() : cp.id;
    Object.assign(dados, camposDividir('compras', id, dados, novo ? null : cp, div));
    if (novo) store.definir('compras', id, dados); else store.atualizar('compras', cp.id, dados);
    fecharModal(); toast(novo ? 'Compra registrada' : 'Compra atualizada');
  });
  ligarExcluir(() => { desfazerDivisao(cp); return cp.recorrenteId ? store.atualizar('compras', cp.id, { excluida: true }) : store.remover('compras', cp.id); });
  ligarParar();
}

function verFatura(cardId) {
  const card = carteira(cardId); if (!card) return;
  const f = C.faturaDe(D, card, ym);
  abrirModal(`Fatura ${card.nome}`, `
    <div class="ccard" style="--c:${card.cor || '#8b5cf6'};margin-top:4px">
      <div class="cc-lbl" style="margin-top:0">${C.rotuloMes(ym)}</div><div class="cc-val">${fmt(f.valor)}</div>
      <div class="cc-meta">Fecha ${C.dataBR(f.fecha)} · vence ${C.dataBR(f.data)} ${f.pago ? `<span class="tag green">Paga em ${C.dataBR(f.pagoEm)}</span>` : f.valor ? tagVenc(f) : ''}</div>
    </div>
    ${f.saldoAnterior > 0 ? `<div class="list g" style="margin-top:14px">
      <div class="row"><div class="ic" style="--c:#fb7185">⏳</div><div class="info"><div class="t">Saldo da fatura de ${C.nomeMes(f.mesAnterior).toLowerCase()} (não paga)</div><div class="m">Venceu sem pagamento e foi somada a esta fatura</div></div><div class="v">${fmt(f.saldoAnterior)}</div></div>
      ${f.jurosEst ? `<div class="row"><div class="ic" style="--c:#fbbf24">📈</div><div class="info"><div class="t">Juros, multa e IOF (estimativa)</div><div class="m">≈${C.taxaAtraso(f.card).toFixed(1).replace('.', ',')}% sobre o saldo em atraso · o valor real vem na fatura do banco</div></div><div class="v">${fmt(f.jurosEst)}</div></div>` : `<div class="row"><div class="ic" style="--c:#fbbf24">📈</div><div class="info"><div class="t">+ juros do banco</div><div class="m">Cadastre a taxa de juros do cartão (editar cartão) para o app estimar</div></div></div>`}
    </div>` : ''}
    ${f.rolada ? '<div class="aviso">⚠️ Esta fatura venceu sem pagamento. O valor já está somado à fatura do mês seguinte, com juros. Pagando a próxima fatura, esta também fica quitada.</div>' : ''}
    <div class="sec" style="margin-top:16px">
      ${f.itens.length ? `<div class="list g">${f.itens.map((p) => {
        const ci = C.catInfo(p.compra.categoria);
        return `<div class="row"><div class="ic" style="--c:${ci.c}">${icone(ci.e)}</div>
          <div class="info" data-a="editar-compra" data-id="${p.compra.id}"><div class="t">${esc(p.compra.descricao)}</div>
          <div class="m">${C.dataBR(p.compra.data)}${p.n > 1 ? ` · parcela ${p.i}/${p.n}` : ''}${p.compra.recorrenteId ? ' · 🔁 assinatura' : ''}</div></div>
          <div class="v">${fmt(p.valor)}</div></div>`;
      }).join('')}</div>` : '<div class="vazio g">Nenhuma compra nesta fatura.</div>'}
    </div>
    ${f.valor > 0 || f.pago ? `<form id="f">
      ${f.pago ? '' : C.contasBancarias(D).length ? `<label>Pagar com</label><select name="carteiraId">${optsCarteiras(carteiraPadrao())}</select>` : ''}
      <button type="button" class="btn big" data-a="conferir-fatura" data-id="${f.id}">🔍 Conferir com o valor do banco</button>
      ${f.pago ? '' : `<button type="button" class="btn big" data-a="renegociar-fatura" data-id="${f.id}">Renegociei esta fatura</button>`}
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

// Fatura renegociada com o banco: ela (e o atraso que já estava dentro dela) é quitada sem sair dinheiro de conta,
// e o acordo vira uma compra parcelada no mesmo cartão. O nome "Refinanciamento" faz o acordo aparecer em Dívidas.
function renegociarFatura(f) {
  const card = f.card;
  const prox = C.somarMes(f.ym, 1);
  abrirModal(`Renegociar fatura de ${C.nomeMes(f.ym).toLowerCase()}`, `<form id="f">
    <p class="sub" style="margin-top:0">A fatura de ${fmt(f.valor)} sai de "a pagar" sem descontar de nenhuma conta, e as parcelas do acordo entram nas próximas faturas do ${esc(card.nome)}.</p>
    <div class="linha">
      <div><label>Parcelas</label><input name="n" type="number" min="1" max="48" required value="6" inputmode="numeric"></div>
      <div><label>Valor da parcela</label><input name="parcela" required inputmode="decimal" placeholder="R$ 0,00"></div>
    </div>
    <label>Primeira parcela na fatura de</label><input name="ym" type="month" required value="${prox}">
    <label>Descrição</label><input name="descricao" required maxlength="80" value="Refinanciamento da fatura de ${C.nomeMes(f.ym).toLowerCase()}">
    <div class="acoes"><button type="button" class="btn" data-a="fechar">Cancelar</button><button class="btn primary">Salvar acordo</button></div>
  </form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const g = new FormData(ev.target);
    const n = Number(g.get('n')); const parcela = C.parseValor(g.get('parcela')); const ym1 = g.get('ym');
    if (!(n >= 1) || !(parcela > 0)) { toast('Informe as parcelas e o valor'); return; }
    // Data da compra que faz a 1ª parcela cair na fatura escolhida (pela regra de fechamento do cartão).
    const base = new Date(`${C.hojeISO()}T12:00`);
    let data = null;
    for (let k = -45; k <= 75 && !data; k++) {
      const d = new Date(base); d.setDate(d.getDate() + k);
      const iso = `${d.getFullYear()}-${C.pad(d.getMonth() + 1)}-${C.pad(d.getDate())}`;
      if (C.parcelasDe({ data: iso, valor: parcela * n, parcelas: n }, card)[0]?.ym === ym1) data = iso;
    }
    if (!data) { toast('Não consegui encaixar a 1ª parcela nessa fatura'); return; }
    store.definir('faturas', f.id, { pago: true, pagoEm: C.hojeISO(), carteiraId: null, valor: 0, renegociada: true });
    (f.anteriores || []).forEach((id) => store.definir('faturas', id, { pago: true, pagoEm: C.hojeISO(), carteiraId: null, valor: 0, quitadaPor: f.id }));
    store.adicionar('compras', { carteiraId: card.id, descricao: g.get('descricao').trim(), valor: C.r2(parcela * n), parcelas: n, data, categoria: 'Cartão de crédito', origem: 'renegociacao' });
    fecharModal();
    toast(`Acordo salvo: ${n}x de ${fmt(parcela)}`);
  });
}

function pagarFatura(f, carteiraId) {
  if (f.pago) {
    store.definir('faturas', f.id, { pago: false, pagoEm: null, carteiraId: null, valor: 0 });
    // Reabre as faturas anteriores que tinham sido quitadas junto com esta.
    D.faturas.filter((x) => x.quitadaPor === f.id).forEach((x) => store.definir('faturas', x.id, { pago: false, pagoEm: null, carteiraId: null, valor: 0 }));
    toast('Fatura voltou para "a pagar"');
  } else {
    store.definir('faturas', f.id, { pago: true, pagoEm: C.hojeISO(), carteiraId: carteiraId ?? carteiraPadrao(), valor: f.valor });
    // O saldo das faturas atrasadas estava dentro desta: marca-as como quitadas, sem descontar de novo da conta.
    (f.anteriores || []).forEach((id) => store.definir('faturas', id, { pago: true, pagoEm: C.hojeISO(), carteiraId: null, valor: 0, quitadaPor: f.id }));
    toast(`${f.descricao} paga${f.anteriores?.length ? ' (inclui o atraso)' : ''}`);
  }
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
      ${novo ? '' : `<label>🔍 Conferir saldo: quanto o banco mostra hoje? (opcional)</label><input name="saldoReal" inputmode="decimal" placeholder="Saldo no app: ${fmt(C.saldoCarteira(D, c))}">`}
      <label>Juros do cheque especial (% ao mês, opcional)</label><input name="jurosNegativo" inputmode="decimal" placeholder="Padrão: 8" value="${c.jurosNegativo ? String(c.jurosNegativo).replace('.', ',') : ''}">
      <div class="aviso">Quanto havia nesta conta ao começar a usar o app. Use <b>Negativo</b> se a conta está no cheque especial ou com saldo devedor. Entradas, contas pagas e transferências ligadas a ela atualizam o saldo, que também pode ficar negativo.</div>
    </div>
    <div id="campos-cartao">
      <label>Limite (opcional)</label><input name="limite" inputmode="decimal" placeholder="0,00" value="${c.limite ? Number(c.limite).toFixed(2).replace('.', ',') : ''}">
      <div class="linha">
        <div><label>Dia do fechamento</label><input name="fechamento" type="number" min="1" max="31" value="${c.fechamento || 1}"></div>
        <div><label>Dia do vencimento</label><input name="vencimento" type="number" min="1" max="31" value="${c.vencimento || 10}"></div>
      </div>
      <label>Juros do rotativo (% ao mês, opcional)</label><input name="jurosAtraso" inputmode="decimal" placeholder="Ex.: 15,99" value="${c.jurosAtraso ? String(c.jurosAtraso).replace('.', ',') : ''}">
      <div class="aviso">Está na fatura do banco ("Juros do rotativo" ou "Juros máximos do contrato"). Serve para o app estimar os juros quando uma fatura atrasa e passa para o mês seguinte.</div>
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
      Object.assign(dados, { limite: C.parseValor(f.get('limite')) || 0, fechamento: fe, vencimento: ve, jurosAtraso: C.parseValor(f.get('jurosAtraso')) || 0 });
    } else {
      // Aceita o sinal pelo seletor ou digitado ("-1.200,00").
      const v = C.parseValor(f.get('saldoInicial')) || 0;
      dados.saldoInicial = C.r2(Math.abs(v) * (v < 0 || f.get('sinal') === '-1' ? -1 : 1));
      dados.jurosNegativo = C.parseValor(f.get('jurosNegativo')) || 0;
      // Conferência: ajusta o saldo inicial para o saldo atual bater com o banco.
      const real = String(f.get('saldoReal') || '').trim();
      if (!novo && real) {
        const rv = (real.includes('-') ? -1 : 1) * Math.abs(C.parseValor(real.replace('-', '')) || 0);
        dados.saldoInicial = C.r2(Number(c.saldoInicial || 0) + (rv - C.saldoCarteira(D, c)));
        toast(`Saldo conferido: ${fmt(rv)}`);
      }
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
      <div class="ic" style="--c:${r.tipo === 'entrada' ? '#4ade80' : C.catInfo(r.categoria).c}">${icone(r.tipo === 'entrada' ? '💰' : C.catInfo(r.categoria).e)}</div>
      <div class="info"><div class="t">${esc(r.descricao)}</div><div class="m">Todo dia ${r.dia}${r.tipo === 'compra' ? ` · 💳 ${esc(carteira(r.carteiraId)?.nome || 'cartão removido')}` : ''}${r.fim ? ' · até ' + C.rotuloMes(r.fim).toLowerCase() : ''}</div></div>
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

  <div class="sec"><div class="sec-h"><h3>Pessoas</h3></div><div class="list g">
    ${linhaConta('ir-dividir', '🤝', '#2dd4bf', 'Dividir contas', seta(conexao() ? esc(nomeOutro()) + (novosDiv(Number(localStorage.getItem(vistoKey(conexao().id))) || 0).length ? ' · <span class="tag amber">novo</span>' : '') : 'Convidar'))}
  </div></div>

  <div class="sec"><div class="sec-h"><h3>Módulos</h3></div><div class="list g">
    ${linhaConta('cfg-mod-comissoes', '💼', '#fbbf24', 'Comissões de vendas', `<span class="sw ${modCom() ? 'on' : ''}"></span>`)}
    ${modCom() ? linhaConta('cfg-percentual', '％', '#fbbf24', 'Comissão padrão', seta(`${String(Number(p.percentualComissao) || 1).replace('.', ',')}%`)) : ''}
    ${linhaConta('cfg-telegram', '✈️', '#38bdf8', 'Bot do Telegram', seta((D.config.find((x) => x.id === 'telegram') || {}).conectado ? 'Conectado' : 'Conectar'))}
  </div></div>

  <div class="sec"><div class="sec-h"><h3>Seus dados</h3></div><div class="list g">
    ${linhaConta('exportar-planilha', '📊', '#4ade80', 'Exportar planilha do Excel', seta('.xlsx'))}
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

function configTelegram() {
  const tg = D.config.find((x) => x.id === 'telegram') || {};
  abrirModal('Bot do Telegram', `
    <div class="aviso" style="margin-top:4px">Lance gastos escrevendo no Telegram (ex.: <b>50 mercado nubank</b>), mande foto de comprovante e consulte saldo e faturas com <b>/saldo</b>, <b>/fatura</b> e <b>/hoje</b>. Tudo cai no <b>seu</b> perfil.</div>
    ${tg.conectado ? `<div class="aviso">✅ Conectado desde ${C.dataBR(tg.desde || '')}. Para desconectar, mande <b>/sair</b> no bot.</div>` : ''}
    <div class="aviso" style="opacity:.8">O bot roda na conta Google do dono do app, que tem acesso técnico ao banco de dados.</div>
    <div class="acoes"><button class="btn primary" id="tg-ir">${tg.conectado ? 'Conectar de novo' : 'Conectar Telegram'}</button></div>
    <div class="aviso" id="tg-st" style="display:none"></div>`);
  $('#tg-ir').addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Gerando código…';
    // Abre a janela já no clique (o navegador bloqueia popups abertos depois de um await).
    const w = window.open('', '_blank');
    try {
      const cod = await store.criarVinculo();
      const url = `https://t.me/violinhabot?start=${cod}`;
      if (w) w.location.href = url; else location.href = url;
      const st = $('#tg-st'); st.style.display = '';
      st.innerHTML = `No Telegram, toque em <b>Iniciar</b>. O bot responde em até 1 minuto.<br>Não abriu? <a href="${url}" target="_blank" rel="noopener">Abrir @violinhabot</a> (código vale 10 min).`;
      b.textContent = 'Código gerado';
    } catch (e) {
      if (w) w.close();
      b.disabled = false; b.textContent = 'Conectar Telegram';
      toast('Não deu para gerar o código: ' + (e.message || e));
    }
  });
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

// A planilha do Excel fica em planilha.js e só é carregada quando o usuário pede.
let gerandoPlanilha = false;
async function exportarPlanilha() {
  if (gerandoPlanilha) return;
  gerandoPlanilha = true;
  toast('Gerando planilha…');
  try {
    const X = await import('./planilha.js?v=3.8');
    const { blob, lancamentos } = await X.gerarPlanilha({ D, ym, nomeCarteira: (id) => carteira(id)?.nome || '', usuario: prefs().apelido || (usuario.displayName || '').split(' ')[0] });
    baixar(`financas-${ym}.xlsx`, blob, blob.type);
    toast(`Planilha de ${C.rotuloMes(ym).toLowerCase()} pronta · ${plural(lancamentos, 'lançamento', 'lançamentos')}`);
  } catch (e) {
    console.error(e);
    toast(e.message || 'Não foi possível gerar a planilha');
  } finally { gerandoPlanilha = false; }
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

// ---------------- v2.6: fluxo, dívidas, boletos, financiamentos, importação ----------------
function datalistHistorico() {
  const vistos = new Set(); const ops = [];
  [...C.vis(D.compras), ...C.vis(D.contas)].sort((x, y) => (y.data || '').localeCompare(x.data || '')).forEach((x) => {
    const d = (x.descricao || '').replace(/\s*\(parcela.*$|\s*·\s*parcela.*$/i, '').trim();
    if (d && !vistos.has(d.toLowerCase()) && ops.length < 80) { vistos.add(d.toLowerCase()); ops.push(d); }
  });
  return `<datalist id="dl-hist">${ops.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;
}
// Ao escolher uma descrição já usada, repete categoria e cartão/conta da última vez.
function ligarSugestoes(form) {
  const campo = form.querySelector('[name=descricao]'); if (!campo) return;
  campo.addEventListener('change', () => {
    const d = campo.value.trim().toLowerCase(); if (!d) return;
    const ult = [...C.vis(D.compras), ...C.vis(D.contas)].filter((x) => (x.descricao || '').toLowerCase().startsWith(d)).sort((x, y) => (y.data || '').localeCompare(x.data || ''))[0];
    const cat = ult ? ult.categoria : P.categorizar(campo.value, []);
    if (cat && form.categoria) form.categoria.value = cat;
    if (ult && ult.carteiraId && form.carteiraId && [...form.carteiraId.options].some((o) => o.value === ult.carteiraId)) form.carteiraId.value = ult.carteiraId;
    if (ult && form.valor && !form.valor.value) form.valor.value = Number(ult.valor).toFixed(2).replace('.', ',');
    form.dispatchEvent(new Event('input', { bubbles: true }));
  });
}



function miniGrafico(serie, alto = 46) {
  const vs = serie.map((x) => x.s); const max = Math.max(0, ...vs); const min = Math.min(0, ...vs); const amp = max - min || 1;
  const W = 300; const pts = serie.map((x, i) => `${(i / (serie.length - 1)) * W},${alto - ((x.s - min) / amp) * alto}`).join(' ');
  const z = alto - ((0 - min) / amp) * alto;
  return `<svg viewBox="0 0 ${W} ${alto}" preserveAspectRatio="none" class="mini" style="width:100%;height:${alto}px;margin-top:8px;display:block">
    <line x1="0" x2="${W}" y1="${z}" y2="${z}" stroke="rgba(255,255,255,.18)" stroke-dasharray="3 3" stroke-width="1"/>
    <polyline points="${pts}" fill="none" stroke="${Math.min(...vs) < 0 ? '#fb7185' : '#4ade80'}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function telaFluxo() {
  const p = P.projecao(D, 60, { comissoes: modCom() });
  const ent = p.ev.filter((e) => e.v > 0).reduce((t, e) => t + e.v, 0); const sai = p.ev.filter((e) => e.v < 0).reduce((t, e) => t - e.v, 0);
  return `<button class="link" data-a="ir" data-id="inicio" style="margin:10px 4px">‹ Voltar</button>
  <div class="card g">
    <div class="lbl">Fluxo de caixa · próximos 60 dias</div>
    <div class="stats" style="margin-top:8px">
      <div><div class="lbl">Saldo hoje</div><div class="val ${p.saldo0 < 0 ? 'neg' : ''}">${fmt(p.saldo0)}</div></div>
      <div><div class="lbl">Entradas</div><div class="val pos">${fmt(ent)}</div></div>
      <div><div class="lbl">Saídas</div><div class="val warn">${fmt(sai)}</div></div>
    </div>
    ${miniGrafico(p.serie, 120)}
    <div class="barra-lbl"><span>hoje</span><span>+30 dias</span><span>+60 dias</span></div>
    <div class="aviso">${p.min.s < 0 ? `⚠️ <b>Vai faltar dinheiro:</b> o saldo chega a ${fmt(p.min.s)} em ${C.dataBR(p.min.d)}. Antecipe uma entrada, negocie um vencimento ou corte gastos antes dessa data.` : `✅ O saldo não fica negativo nos próximos 60 dias. Menor ponto: ${fmt(p.min.s)} em ${C.dataBR(p.min.d)}.`}
      <br>💸 Pode gastar <b>${fmt(p.podeGastar)}/dia</b>${p.prox ? ` até a próxima entrada (${C.dataBR(p.prox.d)}: ${esc(p.prox.t)})` : ' nos próximos 30 dias'}.</div>
  </div>
  <div class="sec"><div class="sec-h"><h3>Próximos lançamentos</h3></div>
    ${p.ev.length ? `<div class="list g">${p.ev.slice(0, 40).map((e) => `<div class="row">
      <div class="ic" style="--c:${e.v > 0 ? '#4ade80' : e.k === 'fatura' ? '#a78bfa' : e.k === 'vencida' ? '#fb7185' : '#fbbf24'}">${e.v > 0 ? '💰' : e.k === 'fatura' ? '💳' : e.k === 'vencida' ? '⚠️' : '🧾'}</div>
      <div class="info"><div class="t">${esc(e.t)}</div><div class="m">${C.dataBR(e.d)}${e.k === 'vencida' ? ' · vencida (contada para hoje)' : ''} · saldo depois: <span class="${e.saldo < 0 ? 'neg' : ''}">${fmt(e.saldo)}</span></div></div>
      <div class="v ${e.v > 0 ? 'pos' : ''}">${e.v > 0 ? '+' : '−'} ${fmt(Math.abs(e.v))}</div></div>`).join('')}</div>` : '<div class="vazio g">Nada previsto para os próximos 60 dias.</div>'}
  </div>
  <p class="rodape">A previsão usa o saldo das suas contas, contas a pagar, entradas, recorrências, faturas (com assinaturas) e comissões. Mantenha os saldos conferidos para ela ficar precisa.</p>`;
}

// "Seu plano, passo a passo": a ordem prática para sair das dívidas, com os números de hoje.
function guiaDividas(ds, sim, aporte, minimo) {
  const r = C.resumoMes(D, C.ymAtual());
  const saldo = C.saldoTotal(D);
  const rot = ds.filter((d) => !d.parcela).sort((a, b) => b.taxa - a.taxa);
  const par = ds.filter((d) => d.parcela > 0);
  const parcelasMes = C.r2(par.reduce((t, d) => t + Math.min(d.parcela, d.saldo), 0));
  const ultimo = par.reduce((m, d) => Math.max(m, d.restantes || 0), 0);
  const passos = [];
  passos.push(saldo >= r.aPagar
    ? { t: 'Garanta as contas do mês', d: `Faltam ${fmt(r.aPagar)} em contas de ${C.nomeMes(C.ymAtual()).toLowerCase()} e você tem ${fmt(saldo)} nas contas. Pague-as primeiro: atrasar uma conta gera multa e juros novos.` }
    : { t: 'Garanta as contas do mês', d: `Faltam ${fmt(r.aPagar)} em contas de ${C.nomeMes(C.ymAtual()).toLowerCase()}, mas o saldo é ${fmt(saldo)}. Priorize as que têm multa maior ou cortam serviço (luz, internet, financiamento) e veja o que dá para adiar sem juros.` });
  if (rot.length) {
    const d = rot[0]; const j = C.r2((d.saldo * d.taxa) / 100);
    passos.push({ t: `Ataque o juro mais caro: ${d.nome}`, d: `${fmt(d.saldo)} a ≈${String(d.taxa).replace('.', ',')}% ao mês custam cerca de ${fmt(j)} por mês só de juros. Todo real extra vai para cá primeiro${rot.length > 1 ? `; depois, ${rot.slice(1).map((x) => esc(x.nome)).join(', ')}` : ''}.` });
  }
  if (par.length) passos.push({ t: 'Mantenha os acordos em dia', d: `${plural(par.length, 'acordo soma', 'acordos somam')} ${fmt(parcelasMes)} por mês, sem juros novos se pagos no vencimento${ultimo ? `; o último termina em ${C.rotuloMes(C.somarMes(C.ymAtual(), ultimo)).toLowerCase()}` : ''}. Atrasar uma parcela pode cancelar o acordo e trazer a dívida cheia de volta.` });
  passos.push(sim.viavel
    ? { t: 'Siga o plano', d: `Separando ${fmt(aporte)} por mês, você fica livre das dívidas em ${plural(sim.meses, 'mês', 'meses')} (${C.rotuloMes(C.somarMes(C.ymAtual(), sim.meses)).toLowerCase()}), pagando ${fmt(sim.juros)} de juros até lá.` }
    : { t: 'Ajuste o valor mensal', d: `Com ${fmt(aporte)} por mês a dívida cresce. O mês mais pesado exige ${fmt(minimo)}: aumente o valor no simulador ou negocie o rotativo com o banco.` });
  const mesDe = (n) => C.rotuloMes(C.somarMes(C.ymAtual(), n));
  const nomeDe = (id) => esc(ds.find((d) => d.id === id)?.nome || id);
  // Comparação das estratégias com o mesmo valor mensal, e o cenário de pagar só o mínimo.
  const cenarios = [
    ['Avalanche', 'maior juro primeiro', P.simular(ds, aporte, 'avalanche'), aporte],
    ['Bola de neve', 'menor dívida primeiro', P.simular(ds, aporte, 'bola'), aporte],
    ['Só o mínimo', `${fmt(minimo)} por mês`, P.simular(ds, minimo, prefs().planoEstrategia || 'avalanche'), minimo],
  ];
  const cmp = cenarios.map(([n, d, s]) => `<div class="row"><div class="info"><div class="t">${n}</div><div class="m">${d}</div></div>
    <div class="v" style="text-align:right">${s.viavel ? `${plural(s.meses, 'mês', 'meses')}<div class="m">${fmt(s.juros)} de juros</div>` : '<span class="neg">não fecha</span>'}</div></div>`).join('');
  const linhas = (sim.linhas || []).slice(0, 24).map((l) => {
    const itens = Object.entries(l.pg).filter(([, v]) => Math.abs(v) > 0.005);
    const total = C.r2(itens.reduce((t, [, v]) => t + v, 0));
    return `<div class="mes-plano"><div class="mp-h"><b>${mesDe(l.mes)}</b><span>${fmt(total)}</span></div>
      ${itens.map(([id, v]) => `<div class="mp-l"><span>${nomeDe(id)}${l.quitadas.includes(id) ? ' <b class="pos">quitada</b>' : ''}</span><span>${fmt(v)}</span></div>`).join('')}
      ${l.juros > 0 ? `<div class="mp-l m"><span>Juros do mês</span><span>${fmt(l.juros)}</span></div>` : ''}</div>`;
  }).join('');
  // "E se...": quanto muda o prazo e os juros com um esforço extra.
  const est = prefs().planoEstrategia || 'avalanche';
  const eSe = [['Separar R$ 200 a mais por mês', P.simular(ds, aporte + 200, est)], ['Antecipar R$ 500 no 1º mês', P.simular(ds, aporte, est, 500)]]
    .filter(([, s]) => s.viavel && sim.viavel)
    .map(([t, s]) => {
      const dm = sim.meses - s.meses; const dj = C.r2(sim.juros - s.juros);
      return `<div class="row"><div class="info"><div class="t">${t}</div><div class="m">${dm > 0 ? `${plural(dm, 'mês', 'meses')} antes` : 'mesmo prazo'} · ${dj > 0 ? `${fmt(dj)} a menos de juros` : 'juros quase iguais'}</div></div></div>`;
    }).join('');
  // Dicas só para os tipos de dívida que existem.
  const tipos = new Set(ds.map((d) => (d.tipo.startsWith('Parcelado') ? 'acordo' : d.tipo)));
  const DICAS = {
    'Fatura em atraso': 'Rotativo do cartão é o juro mais caro. Peça ao banco o parcelamento da fatura: costuma ter juro bem menor, e por lei os encargos do rotativo não passam de 100% da dívida.',
    'Cheque especial': 'Cheque especial cobra até 8% ao mês. Se não der para cobrir logo, troque por um empréstimo pessoal ou consignado com taxa menor e use o dinheiro para zerar a conta.',
    acordo: 'Acordo em dia não gera juro novo. Coloque as parcelas no débito automático ou num lembrete, e não use o cartão renegociado enquanto o acordo durar.',
    'Conta vencida': 'Conta vencida tem multa de até 2% e juros de cerca de 1% ao mês. Pague antes das que têm corte de serviço ou negativação.',
  };
  const dicas = Object.keys(DICAS).filter((k) => tipos.has(k)).map((k) => `<div class="row"><div class="info"><div class="m">${DICAS[k]}</div></div></div>`).join('');
  const extras = `${eSe ? `<div class="sec"><div class="sec-h"><h3>E se…</h3></div><div class="list g guia">${eSe}</div></div>` : ''}
  ${dicas ? `<div class="sec"><div class="sec-h"><h3>Dicas para as suas dívidas</h3></div><div class="list g guia">${dicas}</div></div>` : ''}`;
  return `<div class="sec"><div class="sec-h"><h3>Seu plano, passo a passo</h3></div>
    <div class="list g guia">${passos.map((p, i) => `<div class="row"><div class="ic" style="--c:#c6f432">${i + 1}</div><div class="info"><div class="t">${esc(p.t)}</div><div class="m">${p.d}</div></div></div>`).join('')}</div></div>
  <div class="sec"><div class="sec-h"><h3>Comparar estratégias</h3></div><div class="list g guia">${cmp}</div>
    <p class="vazio-txt" style="margin-top:8px">Mesmo valor mensal nas duas primeiras. O rotativo do cartão para de crescer quando os juros chegam a 100% da dívida, como manda a lei.</p></div>
  ${extras}
  ${linhas ? `<div class="sec"><details class="dicas plano-mes"><summary>Mês a mês: quanto pagar em cada dívida</summary>${linhas}</details></div>` : ''}`;
}

function telaDividas() {
  const ds = P.listaDividas(D);
  const p = prefs();
  const estrategia = p.planoEstrategia || 'avalanche';
  const totalD = C.soma(ds.map((d) => ({ valor: d.saldo })));
  const jurosMes = ds.reduce((t, d) => t + (d.parcela ? 0 : (d.saldo * d.taxa) / 100), 0);
  const base = P.simular(ds, 0, estrategia);
  const aporte = Number(p.planoValor) || Math.ceil((base.minimo * 1.3) / 50) * 50;
  const sim = P.simular(ds, aporte, estrategia);
  const nomeDe = (id) => ds.find((d) => d.id === id)?.nome || id;
  const quando = (n) => C.rotuloMes(C.somarMes(C.ymAtual(), n)).toLowerCase();
  const fins = D.recorrentes.filter((r) => r.financiamento);
  return `<button class="link" data-a="ir" data-id="planejar" style="margin:10px 4px">‹ Voltar</button>
  <div class="card g">
    <div class="lbl">📉 Plano de saída das dívidas</div>
    <div class="stats" style="margin-top:8px">
      <div><div class="lbl">Dívida total</div><div class="val neg">${fmt(totalD)}</div></div>
      <div><div class="lbl">Juros por mês</div><div class="val warn">${fmt(jurosMes)}</div></div>
      <div><div class="lbl">Dívidas</div><div class="val">${ds.length}</div></div>
    </div>
    ${jurosMes > 0 ? `<div class="aviso">Hoje você perde cerca de <b>${fmt(jurosMes)} por mês</b> (${fmt(jurosMes * 12)} por ano) só com juros das dívidas rotativas.</div>` : ''}
  </div>
  ${ds.length ? `<div class="sec"><div class="sec-h"><h3>Suas dívidas</h3></div><div class="list g">${ds.map((d) => `<div class="row">
      <div class="ic" style="--c:${d.parcela ? '#60a5fa' : '#fb7185'}">${d.tipo === 'Financiamento' ? '🏠' : d.parcela ? '📆' : '🔥'}</div>
      <div class="info"><div class="t">${esc(d.nome)}</div><div class="m">${esc(d.tipo)} · ${d.parcela ? `${d.restantes}x de ${fmt(d.parcela)}${d.juros ? ` · ${String(d.juros).replace('.', ',')}% a.m.` : ''}` : `juros ≈${d.taxa.toFixed(1).replace('.', ',')}% ao mês`}</div></div>
      <div class="v neg">${fmt(d.saldo)}</div></div>`).join('')}</div></div>

  <div class="sec"><div class="sec-h"><h3>Simulador</h3></div><div class="card g">
    <form id="f-plano">
      <label>Quanto consigo separar por mês para as dívidas</label>
      <input name="aporte" data-plano inputmode="decimal" value="${String(aporte).replace('.', ',')}" style="font-size:1.3rem;font-weight:700;text-align:center">
      <label>Estratégia</label>
      <div class="seg">
        <label><input type="radio" name="estrategia" value="avalanche" data-plano ${estrategia === 'avalanche' ? 'checked' : ''}>🏔️ Avalanche</label>
        <label><input type="radio" name="estrategia" value="bola" data-plano ${estrategia === 'bola' ? 'checked' : ''}>⛄ Bola de neve</label>
      </div>
      <div class="sub" style="margin-top:6px">${estrategia === 'avalanche' ? 'Avalanche: paga primeiro a dívida com o maior juro. É a que economiza mais.' : 'Bola de neve: paga primeiro a menor dívida. Dá vitórias rápidas e motiva.'}</div>
    </form>
    ${sim.falta > 0 || (!sim.viavel && sim.meses >= 120) ? `<div class="aviso" style="border-color:rgba(251,113,133,.4)">⚠️ ${fmt(aporte)} por mês não cobre as parcelas e os juros. O mês mais pesado exige cerca de <b>${fmt(base.minimo)}</b>; com menos que isso, a dívida aumenta.</div>`
      : `<div class="hstats" style="margin-top:14px">
        <div><span>Livre das dívidas em</span><b>${sim.meses} ${sim.meses === 1 ? 'mês' : 'meses'}</b><small>${quando(sim.meses)}</small></div>
        <div><span>Juros até lá</span><b>${fmt(sim.juros)}</b></div>
        <div><span>Mínimo mensal</span><b>${fmt(base.minimo)}</b></div>
      </div>
      <div class="lbl-f" style="margin-top:16px;font-weight:600;color:var(--text)">Ordem de quitação</div>
      <div class="list g">${sim.ordem.map((id, i) => `<div class="row"><div class="ic" style="--c:#c6f432">${i + 1}</div><div class="info"><div class="t">${esc(nomeDe(id))}</div><div class="m">quitada em ${quando(sim.quitacao[id])}</div></div></div>`).join('')}</div>`}
  </div></div>
  ${guiaDividas(ds, sim, aporte, base.minimo)}` : '<div class="vazio g" style="margin-top:12px"><span class="big">🎉</span>Nenhuma dívida cadastrada. Continue assim!</div>'}

  <div class="sec"><div class="sec-h"><h3>Financiamentos</h3><button data-a="novo-financiamento">+ Novo</button></div>
    ${fins.length ? fins.map((r) => { const i = P.infoFinanciamento(D, r); return `<button class="meta g" data-a="editar-financiamento" data-id="${r.id}">
      ${anel(i.pct, '#60a5fa', '🏠')}
      <div class="info"><div class="t">${esc(r.descricao)}</div>
      <div class="v">${fmt(r.valor)} <span style="color:var(--faint);font-weight:500">por mês</span></div>
      <div class="m">${i.pagas} de ${i.total} pagas · termina em ${C.rotuloMes(r.fim).toLowerCase()} · faltam ${fmt(i.saldo)}</div></div></button>`; }).join('')
      : '<div class="vazio g">Cadastre financiamentos (carro, casa, crediário) para acompanhar o saldo devedor e quando termina.</div>'}
  </div>`;
}

function formFinanciamento(r) {
  const novo = !r;
  r = r || { descricao: '', valor: null, dia: 10, totalParcelas: 48, parcelaInicial: 1, juros: '', categoria: 'Transporte', carteiraId: carteiraPadrao() };
  const pagas = (Number(r.parcelaInicial) || 1) - 1;
  abrirModal(novo ? 'Novo financiamento' : 'Editar financiamento', `<form id="f">
    ${campoValor(r.valor, 'Valor da parcela')}
    <label>Descrição</label><input name="descricao" required maxlength="60" placeholder="Ex.: Financiamento do carro" value="${esc(r.descricao)}">
    <div class="linha">
      <div><label>Total de parcelas</label><input name="total" type="number" min="1" max="480" required value="${r.totalParcelas}"></div>
      <div><label>Já pagas</label><input name="pagas" type="number" min="0" max="480" required value="${pagas}"></div>
    </div>
    <div class="linha">
      <div><label>Dia do vencimento</label><input name="dia" type="number" min="1" max="31" required value="${r.dia}"></div>
      <div><label>Juros (% a.m., opcional)</label><input name="juros" inputmode="decimal" placeholder="Ex.: 1,49" value="${r.juros ? String(r.juros).replace('.', ',') : ''}"></div>
    </div>
    <div class="linha">
      <div><label>Categoria</label><select name="categoria">${optsCategorias(r.categoria)}</select></div>
      ${C.contasBancarias(D).length ? `<div><label>Pagar com</label><select name="carteiraId">${optsCarteiras(r.carteiraId)}</select></div>` : ''}
    </div>
    <div class="aviso" id="prev-fin"></div>
    ${novo ? '' : '<div class="aviso">Mudanças valem para as próximas parcelas. As já lançadas continuam como estão.</div>'}
    ${botoes(!novo)}
  </form>`);
  const form = $('#f');
  const prev = () => {
    const f = new FormData(form); const v = C.parseValor(f.get('valor')); const tot = Number(f.get('total')); const pg = Number(f.get('pagas'));
    const rest = Math.max(0, tot - pg);
    $('#prev-fin').innerHTML = v > 0 && tot ? `Faltam <b>${rest} parcelas</b> · saldo devedor <b>${fmt(rest * v)}</b> · termina em <b>${C.rotuloMes(C.somarMes(C.ymAtual(), rest - 1)).toLowerCase()}</b>.` : 'Preencha valor e parcelas.';
  };
  form.addEventListener('input', prev); prev();
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form); const valor = lerValor(f); if (valor === null) return;
    const tot = Number(f.get('total')); const pg = Number(f.get('pagas'));
    if (!(tot > 0) || pg < 0 || pg >= tot) { toast('Confira o total e as parcelas pagas'); return; }
    const dados = { tipo: 'conta', financiamento: true, descricao: f.get('descricao').trim(), valor, dia: Number(f.get('dia')), totalParcelas: tot, juros: C.parseValor(f.get('juros')) || 0, categoria: f.get('categoria'), carteiraId: f.get('carteiraId') || null };
    if (novo) {
      const inicio = C.ymAtual();
      Object.assign(dados, { inicio, parcelaInicial: pg + 1, fim: C.somarMes(inicio, tot - pg - 1) });
      store.definir('recorrentes', store.novoId(), dados);
    } else {
      // Mantém o início; recalcula o fim a partir das parcelas pagas informadas.
      const jaGeradas = P.mesesEntre(r.inicio, C.ymAtual());
      Object.assign(dados, { inicio: r.inicio, parcelaInicial: pg + 1 - jaGeradas, fim: C.somarMes(C.ymAtual(), tot - pg - 1) });
      store.atualizar('recorrentes', r.id, dados);
    }
    fecharModal(); toast(novo ? '🏠 Financiamento cadastrado' : 'Financiamento atualizado');
  });
  ligarExcluir(() => store.atualizar('recorrentes', r.id, { fim: C.somarMes(C.ymAtual(), -1) }));
}

function formBoleto() {
  abrirModal('Boleto', `<form id="f">
    <label>Código do boleto (linha digitável)</label>
    <div class="linha"><div style="flex:3"><input name="codigo" inputmode="numeric" autocomplete="off" placeholder="Cole aqui os números do boleto"></div>
    ${'BarcodeDetector' in window ? '<div style="flex:1"><button type="button" class="btn" style="width:100%;padding:14px 4px" data-escanear>📷 Ler</button></div>' : ''}</div>
    <video id="cam" playsinline muted style="display:none;width:100%;border-radius:16px;margin-top:10px"></video>
    <div class="aviso" id="info-bol">Cole a linha digitável: o app preenche valor e vencimento sozinho.</div>
    ${campoValor(null)}
    <label>Descrição</label><input name="descricao" required maxlength="80" list="dl-hist" placeholder="Ex.: Condomínio, IPVA, Parcela da moto">${datalistHistorico()}
    <div class="linha">
      <div><label>Vencimento</label><input name="data" type="date" required value="${dataPadrao()}"></div>
      <div><label>Categoria</label><select name="categoria">${optsCategorias('Outros')}</select></div>
    </div>
    ${C.contasBancarias(D).length ? `<label>Pagar com</label><select name="carteiraId">${optsCarteiras(carteiraPadrao())}</select>` : ''}
    <div class="acoes"><button class="btn primary">Salvar boleto</button></div>
  </form>`);
  const form = $('#f');
  ligarSugestoes(form);
  const aplicar = () => {
    const b = P.lerBoleto(form.codigo.value);
    if (!b) { $('#info-bol').textContent = form.codigo.value.replace(/\D/g, '').length ? 'Código incompleto: são 47 ou 48 números.' : 'Cole a linha digitável: o app preenche valor e vencimento sozinho.'; return; }
    if (b.valor) form.valor.value = b.valor.toFixed(2).replace('.', ',');
    if (b.vencimento) form.data.value = b.vencimento;
    $('#info-bol').innerHTML = `✅ ${b.tipo === 'bancario' ? 'Boleto bancário' : 'Conta de consumo / convênio'}${b.valor ? ` · ${fmt(b.valor)}` : ''}${b.vencimento ? ` · vence ${C.dataBR(b.vencimento)}` : ' · confira o vencimento'}`;
  };
  form.codigo.addEventListener('input', aplicar);
  const bt = form.querySelector('[data-escanear]');
  if (bt) bt.addEventListener('click', async () => {
    const v = $('#cam');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      v.srcObject = stream; v.style.display = 'block'; await v.play();
      const det = new BarcodeDetector({ formats: ['itf', 'code_128'] });
      const fim = Date.now() + 20000;
      const loop = async () => {
        if (!document.body.contains(v) || Date.now() > fim) { stream.getTracks().forEach((t) => t.stop()); v.style.display = 'none'; return; }
        const r = await det.detect(v).catch(() => []);
        const cod = r.map((x) => x.rawValue.replace(/\D/g, '')).find((x) => x.length === 44);
        if (cod) { form.codigo.value = cod; aplicar(); stream.getTracks().forEach((t) => t.stop()); v.style.display = 'none'; toast('Código lido ✓'); return; }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { toast('Não consegui abrir a câmera'); }
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form); const valor = lerValor(f); if (valor === null) return;
    store.adicionar('contas', { descricao: f.get('descricao').trim(), valor, data: f.get('data'), categoria: f.get('categoria'), carteiraId: f.get('carteiraId') || null, pago: false, pagoEm: null, codigo: f.get('codigo').replace(/\D/g, '') || null });
    fecharModal(); toast('🧾 Boleto salvo em contas a pagar');
  });
}

function conferirFatura(id) {
  const [cardId] = id.split('_'); const card = carteira(cardId); if (!card) return;
  const f = C.faturaDe(D, card, id.slice(cardId.length + 1));
  abrirModal('Conferir fatura', `<form id="f">
    <div class="aviso" style="margin-top:4px">No app: <b>${fmt(f.valor)}</b>. Digite o total que aparece no app do banco para esta fatura (${C.rotuloMes(f.ym).toLowerCase()}).</div>
    ${campoValor(null, 'Total no banco')}
    <div class="aviso" id="dif"></div>
    <div class="acoes"><button class="btn primary">Ajustar</button></div>
  </form>`);
  const form = $('#f');
  form.addEventListener('input', () => { const v = C.parseValor(form.valor.value); $('#dif').innerHTML = v > 0 ? `Diferença: <b>${fmt(v - f.valor)}</b>. Será lançado um ajuste nesta fatura.` : ''; });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = C.parseValor(form.valor.value); if (!(v >= 0)) { toast('Informe o valor'); return; }
    const dif = C.r2(v - f.valor); if (Math.abs(dif) < 0.01) { fecharModal(); toast('✅ Já está igual ao banco'); return; }
    const [y, m, d] = f.fecha.split('-').map(Number); const x = new Date(y, m - 1, d - 1);
    const data = `${x.getFullYear()}-${C.pad(x.getMonth() + 1)}-${C.pad(x.getDate())}`;
    store.adicionar('compras', { carteiraId: card.id, descricao: `Ajuste de conferência (${C.nomeMes(f.ym, true).toLowerCase()})`, valor: dif, data, parcelas: 1, categoria: 'Cartão de crédito' });
    fecharModal(); toast(`Fatura ajustada para ${fmt(v)}`);
  });
}

function importarExtrato() {
  const destinos = D.carteiras;
  if (!destinos.length) { toast('Cadastre uma conta ou cartão primeiro'); return; }
  abrirModal('Importar extrato ou fatura', `<form id="f">
    <label>Para onde vão os lançamentos?</label>
    <select name="destino">${destinos.map((c) => `<option value="${c.id}">${c.tipo === 'cartao' ? '💳' : '🏦'} ${esc(c.nome)}</option>`).join('')}</select>
    <label>Arquivo (CSV ou OFX exportado do banco)</label>
    <input name="arq" type="file" accept=".csv,.ofx,.txt,text/csv">
    <div class="aviso">Nada é enviado para fora: o arquivo é lido no seu aparelho. Você revisa tudo antes de importar.</div>
  </form><div id="prev-imp"></div>`);
  const form = $('#f');
  form.arq.addEventListener('change', async () => {
    const arq = form.arq.files[0]; if (!arq) return;
    const dest = carteira(form.destino.value);
    const itens = P.analisarExtrato(await arq.text(), arq.name, dest, D);
    if (!itens.length) { $('#prev-imp').innerHTML = '<div class="aviso">Não reconheci lançamentos neste arquivo. Ele precisa ter colunas de data, descrição e valor (ou ser OFX).</div>'; return; }
    const sel = itens.map((x) => !x.ignorar && !x.duplicado);
    const desenhar = () => {
      const n = sel.filter(Boolean).length;
      $('#prev-imp').innerHTML = `<div class="sec-h" style="margin-top:16px"><h3>${itens.length} lançamentos</h3></div>
        <div class="list g">${itens.map((x, i) => `<label class="row imp" style="cursor:pointer">
          <input type="checkbox" data-imp="${i}" ${sel[i] ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
          <div class="info"><div class="t">${esc(x.descricao)}</div><div class="m">${C.dataBR(x.data)} · ${C.catInfo(x.categoria).e} ${esc(x.categoria)}${x.duplicado ? ' · <span class="tag amber">já existe</span>' : ''}${x.ignorar ? ' · <span class="tag green">pagamento/crédito</span>' : ''}</div></div>
          <div class="v ${x.gasto ? '' : 'pos'}">${x.gasto ? '' : '+ '}${fmt(x.restantes > 1 ? x.valor * x.restantes : x.valor)}</div></label>`).join('')}</div>
        <div class="acoes"><button type="button" class="btn primary" data-importar>Importar ${n} ${n === 1 ? 'lançamento' : 'lançamentos'}</button></div>`;
      $$('#prev-imp [data-imp]').forEach((c) => c.addEventListener('change', () => { sel[Number(c.dataset.imp)] = c.checked; desenhar(); }));
      $('#prev-imp [data-importar]').addEventListener('click', () => {
        let n2 = 0;
        itens.forEach((x, i) => {
          if (!sel[i]) return; n2++;
          if (dest.tipo === 'cartao') store.adicionar('compras', { carteiraId: dest.id, descricao: x.descricao, valor: C.r2(x.valor * x.restantes), data: x.data, parcelas: x.restantes, categoria: x.categoria });
          else if (x.gasto) store.adicionar('contas', { descricao: x.descricao, valor: x.valor, data: x.data, categoria: x.categoria, carteiraId: dest.id, pago: true, pagoEm: x.data });
          else store.adicionar('entradas', { descricao: x.descricao, valor: x.valor, data: x.data, carteiraId: dest.id });
        });
        fecharModal(); toast(`📥 ${n2} lançamentos importados em ${dest.nome}`);
      });
    };
    desenhar();
  });
}

// Atalhos do ícone do app (?acao=...)
// ---------------- Dividir contas ----------------
// Duas contas Google conectadas por convite. Os itens ficam em conexoes/{id}/itens, que os dois leem.
// "parte" de um item = quanto quem não pagou deve a quem pagou.
let conexoes = [];
let divItens = [];
let divAcertos = [];
let divCid = null;
let pararDiv = null;
let divVistoAntes = 0;
let divVoltar = 'conta';
const meuNome = () => (prefs().apelido || (usuario.displayName || '').split(' ')[0] || 'Alguém').slice(0, 40);
const conexao = () => conexoes[0] || null;
const conexaoAtiva = () => { const c = conexao(); return c && c.membros.length === 2 ? c : null; };
const outroDe = (c) => c.membros.find((x) => x !== usuario.uid) || c.saiu;
const nomeOutro = (c = conexao()) => (c && c.nomes && c.nomes[outroDe(c)]) || 'a outra pessoa';
const vistoKey = (cid) => 'fin-div-visto-' + cid;
const novosDiv = (desde) => divItens.filter((x) => x.criadoPor !== usuario.uid && !x.pago && (x.criadoEm || 0) > desde);

function ouvirConexoes() {
  const parar = store.assinarConexoes((lista) => {
    conexoes = lista.sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
    const c = conexao();
    if ((c ? c.id : null) !== divCid) {
      if (pararDiv) pararDiv();
      pararDiv = null; divItens = []; divAcertos = []; divCid = c ? c.id : null;
      if (c) pararDiv = store.assinarDivisao(c.id, (itens, acertos) => { divItens = itens; divAcertos = acertos; atualizarDivGastos(); agendarRender(); });
      const pend = conviteSalvo();
      if (c && pend && pend.cod === c.id) { localStorage.removeItem('fin-convite'); toast(`🤝 ${nomeOutro(c)} aceitou o convite`); }
    }
    atualizarDivGastos(); agendarRender();
  });
  return () => { parar(); if (pararDiv) pararDiv(); pararDiv = null; divCid = null; conexoes = []; divItens = []; divAcertos = []; atualizarDivGastos(); };
}

// A minha parte dos itens que não são um lançamento meu entra nos gastos dos relatórios (ver C.minhaFracao).
function atualizarDivGastos() {
  const eu = usuario && usuario.uid;
  D.divGastos = divItens.filter((x) => !(x.criadoPor === eu && x.lancado))
    .map((x) => ({ data: x.data, valor: C.minhaParteItem(x, eu), categoria: x.categoria || 'Outros' }))
    .filter((x) => x.valor > 0);
}

function conviteSalvo() {
  try {
    const p = JSON.parse(localStorage.getItem('fin-convite') || 'null');
    if (p && p.expira > Date.now()) return p;
  } catch (e) { /* ignora */ }
  localStorage.removeItem('fin-convite');
  return null;
}
const linkConvite = (cod) => `${location.origin}${location.pathname}?convite=${cod}${modoLocal && new URLSearchParams(location.search).has('local') ? '&local' : ''}`;

async function compartilharConvite(cod) {
  const url = linkConvite(cod);
  const texto = `${meuNome()} te convidou para dividir contas no Minhas Finanças. Abra o link e entre com a sua conta Google (código ${cod}):`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Dividir contas', text: texto, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  navigator.clipboard?.writeText(`${texto} ${url}`).then(() => toast('Link do convite copiado ✓'), () => toast('Código: ' + cod));
}

async function gerarConvite() {
  if (conexaoAtiva()) { toast(`Você já está conectado com ${nomeOutro()}`); return; }
  try {
    const cod = await store.criarConvite(meuNome());
    localStorage.setItem('fin-convite', JSON.stringify({ cod, expira: Date.now() + 47 * 3600000 }));
    render();
    compartilharConvite(cod);
  } catch (e) { toast('Não deu para gerar o convite: ' + (e.message || e)); }
}

function digitarCodigo() {
  abrirModal('Tenho um código', `<form id="f">
    <label>Código ou link do convite</label><input name="cod" required autocomplete="off" autocapitalize="off" placeholder="Ex.: k7m2x9qpaz">
    <div class="acoes"><button class="btn primary">Continuar</button></div></form>`);
  $('#f').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const txt = String(new FormData(ev.target).get('cod') || '').trim();
    const cod = (txt.match(/convite=([a-z0-9]+)/i) || [null, txt])[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cod.length < 6) { toast('Código inválido'); return; }
    abrirConvite(cod);
  });
}

async function abrirConvite(cod) {
  if (conexaoAtiva()) { toast(`Você já está conectado com ${nomeOutro()}. Desfaça a conexão antes.`); return; }
  let conv = null;
  try { conv = await store.lerConvite(cod); } catch (e) { console.warn(e); }
  if (!conv || !(conv.expira > Date.now())) { toast('Convite não encontrado, vencido ou já usado'); return; }
  if (conv.uid === usuario.uid) { toast('Esse convite é seu: mande o link para a outra pessoa'); return; }
  abrirModal('Dividir contas', `
    <div class="aviso" style="margin-top:4px"><b>${esc(conv.nome)}</b> te convidou para dividir contas.<br>Vocês vão ver os itens divididos e o saldo de quem deve a quem. O resto das suas finanças continua só seu.</div>
    <div class="acoes"><button class="btn" data-a="fechar-modal">Agora não</button><button class="btn primary" id="div-aceitar">Conectar</button></div>`);
  $('#div-aceitar').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      await store.aceitarConvite(cod, conv, meuNome());
      fecharModal(); toast(`🤝 Conectado com ${conv.nome}`);
      divVoltar = 'inicio'; trocarTela('dividir');
    } catch (e) { ev.currentTarget.disabled = false; toast('Não deu para conectar: ' + (e.code || e.message || e)); }
  });
}

function blocoConvite() {
  const pend = conviteSalvo();
  const ate = pend ? new Date(pend.expira) : null;
  return `<div class="card g">
    <div class="lbl">🤝 Dividir contas</div>
    <div class="val" style="font-size:1.2rem">Conecte com outra pessoa</div>
    <div class="aviso">Cada um usa a própria conta Google. O que um lança como dividido aparece para o outro, com o saldo de quem deve a quem. O resto das finanças de cada um continua separado.</div>
    ${pend ? `<div class="aviso">⏳ Convite aguardando: <b class="cod">${esc(pend.cod)}</b><br>Vale até ${C.pad(ate.getDate())}/${C.pad(ate.getMonth() + 1)} às ${C.pad(ate.getHours())}:${C.pad(ate.getMinutes())}. A outra pessoa abre o link no celular, entra com a conta Google e toca em Conectar.</div>
      <div class="acoes"><button class="btn" data-a="div-cancelar-convite">Cancelar</button><button class="btn primary" data-a="div-compartilhar">Enviar link</button></div>
      ${modoLocal ? '<button class="btn big" data-a="div-sim-aceite">🧪 Simular: a outra pessoa aceitou</button>' : ''}`
    : '<div class="acoes"><button class="btn" data-a="div-tenho-codigo">Tenho um código</button><button class="btn primary" data-a="div-convidar">Gerar convite</button></div>'}
  </div>`;
}

function linhaDiv(x, c, ativa) {
  const eu = usuario.uid; const nome = esc(nomeOutro(c));
  const euPaguei = x.pagou === eu;
  const ci = C.catInfo(x.categoria);
  const novo = !x.pago && x.criadoPor !== eu && (x.criadoEm || 0) > divVistoAntes;
  const como = Number(x.parte) >= Number(x.valor) ? `tudo é ${euPaguei ? 'de ' + nome : 'seu'}` : x.divisao === 'metade' ? 'metade' : `parte ${euPaguei ? 'de ' + nome : 'sua'} ${fmt(x.parte)}`;
  return `<div class="row ${novo ? 'div-novo' : ''}">
    <div class="ic" style="--c:${ci.c}">${icone(ci.e)}</div>
    <div class="info" data-a="div-item" data-id="${x.id}">
      <div class="t">${esc(x.descricao)}${novo ? ' <span class="tag amber">novo</span>' : ''}</div>
      <div class="m">${C.dataBR(x.data)} · ${euPaguei ? 'você' : nome} pagou ${fmt(x.valor)}, ${como} · lançado por ${x.criadoPor === eu ? 'você' : nome}${x.pago ? ` <span class="tag green">Acertado ${C.dataBR(x.pagoEm)}</span>` : ''}</div>
    </div>
    <div class="v ${euPaguei ? 'pos' : 'neg'}">${euPaguei ? '+' : '−'} ${fmt(x.parte)}</div>
    ${ativa ? `<button class="chk ${x.pago ? 'on' : ''}" data-a="div-pagar" data-id="${x.id}" aria-label="${x.pago ? 'Voltar para em aberto' : 'Marcar como acertado'}">✓</button>` : ''}
  </div>`;
}

function telaDividir() {
  const voltar = `<button class="link" data-a="ir" data-id="${divVoltar}" style="margin:10px 4px">‹ Voltar</button>`;
  const c = conexao();
  if (!c) return voltar + blocoConvite();
  localStorage.setItem(vistoKey(c.id), String(Date.now()));
  const eu = usuario.uid; const nome = esc(nomeOutro(c));
  const ativa = c.membros.length === 2;
  const saldo = C.saldoDivisao(divItens, eu);
  const abertos = divItens.filter((x) => !x.pago).sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.criadoEm || 0) - (a.criadoEm || 0));
  const pagos = divItens.filter((x) => x.pago).sort((a, b) => (b.pagoEm || '').localeCompare(a.pagoEm || '') || (b.data || '').localeCompare(a.data || '')).slice(0, 30);
  const acertos = [...divAcertos].sort((a, b) => (b.em || 0) - (a.em || 0));
  const titulo = saldo > 0 ? `${nome} te deve` : saldo < 0 ? `Você deve a ${nome}` : `Tudo acertado com ${nome}`;
  return `${voltar}
  ${ativa ? '' : `<div class="aviso" style="margin-top:0">⚠️ ${nome} desfez a conexão. Os itens abaixo ficam só para consulta.</div>`}
  <div class="card g div-hero">
    <div class="lbl">🤝 ${titulo}</div>
    <div class="val ${saldo > 0 ? 'pos' : saldo < 0 ? 'neg' : ''}">${saldo ? fmt(Math.abs(saldo)) : '✓'}</div>
    <div class="sub">${abertos.length ? plural(abertos.length, 'item em aberto', 'itens em aberto') : 'Nenhum item em aberto'}</div>
    ${ativa ? `<div class="div-acoes"><button class="btn" data-a="div-novo" data-id="me-deve">＋ ${nome} me deve</button><button class="btn" data-a="div-novo" data-id="devo">＋ Eu devo</button></div>
    ${abertos.length ? '<button class="btn primary big" data-a="div-acertar">Acertar tudo</button>' : ''}` : ''}
  </div>

  <div class="sec"><div class="sec-h"><h3>Em aberto</h3></div>
    ${abertos.length ? `<div class="list g">${abertos.map((x) => linhaDiv(x, c, ativa)).join('')}</div>`
      : `<div class="vazio g"><span class="big">🤝</span>Nada em aberto.${ativa ? `<br>Use os botões acima ou marque <b>Dividir com ${nome}</b> ao lançar uma conta ou compra.` : ''}</div>`}
  </div>

  ${acertos.length ? `<div class="sec"><div class="sec-h"><h3>Acertos</h3></div><div class="list g">${acertos.map((a) => `<div class="row">
    <div class="ic" style="--c:#2dd4bf">🤝</div>
    <div class="info"><div class="t">${!a.valor ? 'Acerto sem valor (os itens se anularam)' : a.de === eu ? `Você pagou ${nome}` : `${nome} pagou você`}</div>
    <div class="m">${C.dataBR(a.data)} · ${plural(a.n || (a.itens || []).length, 'item', 'itens')} · registrado por ${a.criadoPor === eu ? 'você' : nome}</div></div>
    <div class="v">${fmt(a.valor)}</div></div>`).join('')}</div></div>` : ''}

  ${pagos.length ? `<div class="sec"><div class="sec-h"><h3>Acertados</h3></div><div class="list g">${pagos.map((x) => linhaDiv(x, c, ativa)).join('')}</div></div>` : ''}

  ${modoLocal ? `<div class="sec"><div class="list g">
    ${ativa ? linhaConta('div-sim-item', '🧪', '#a1a1aa', `Simular: ${nome} lançou um item`, '') : ''}
    ${ativa ? linhaConta('div-sim-sair', '🧪', '#a1a1aa', `Simular: ${nome} desfez a conexão`, '') : ''}
  </div></div>` : ''}

  <div class="sec"><div class="list g">${linhaConta('div-sair', ativa ? '✂️' : '🗑️', '#fb7185', ativa ? `Desfazer conexão com ${nome}` : 'Apagar histórico', '', 'perigo')}</div></div>
  <p class="rodape">Nos seus relatórios conta só a sua parte de cada item. O pagamento do acerto (Pix, dinheiro) é feito fora do app.</p>`;
}


// Campos de divisão (usados no item dividido e no bloco "Dividir com" de conta/compra).
const camposDivisao = (modo = 'metade', parte = null) => `<label>Divisão</label><select name="divisao">
    <option value="metade" ${modo === 'metade' ? 'selected' : ''}>Metade para cada (50/50)</option>
    <option value="valor" ${modo === 'valor' ? 'selected' : ''}>Um valor específico</option>
    <option value="tudo" ${modo === 'tudo' ? 'selected' : ''}>Tudo é de quem não pagou</option></select>
  <div data-div-valor><label data-div-lbl>Parte de quem não pagou</label><input name="parte" inputmode="decimal" placeholder="R$ 0,00" value="${modo === 'valor' && parte ? Number(parte).toFixed(2).replace('.', ',') : ''}"></div>
  <div class="aviso" data-div-prev></div>`;

// devedor(f) => { nome, euDevo }: quem fica devendo, para os textos.
function ligarDivisao(form, devedor) {
  const sel = form.querySelector('[name=divisao]'); if (!sel) return;
  const at = () => {
    const f = new FormData(form);
    const chk = form.querySelector('[name=dividir]');
    const campos = form.querySelector('[data-div-campos]');
    if (campos) campos.style.display = chk && !chk.checked ? 'none' : '';
    const dev = devedor(f);
    sel.querySelector('[value=tudo]').textContent = dev.euDevo ? 'Tudo é meu (só eu uso)' : `Tudo é de ${dev.nome}`;
    form.querySelector('[data-div-lbl]').textContent = dev.euDevo ? 'Quanto é seu' : `Parte de ${dev.nome}`;
    form.querySelector('[data-div-valor]').style.display = sel.value === 'valor' ? '' : 'none';
    const v = C.parseValor(f.get('valor')) || 0;
    const parte = sel.value === 'metade' ? v / 2 : sel.value === 'tudo' ? v : C.parseValor(f.get('parte')) || 0;
    form.querySelector('[data-div-prev]').innerHTML = v > 0 && parte > 0
      ? `${dev.euDevo ? `Você fica devendo <b>${fmt(parte)}</b> a ${esc(dev.nome)}.` : `${esc(dev.nome)} fica devendo <b>${fmt(parte)}</b> para você.`}${parte > v ? ' <span class="neg">Maior que o total!</span>' : ''}`
      : 'Informe o valor para ver a divisão.';
  };
  form.addEventListener('input', at); form.addEventListener('change', at); at();
}

function lerDivisao(f, valor) {
  const divisao = f.get('divisao') || 'metade';
  const parte = C.r2(divisao === 'metade' ? valor / 2 : divisao === 'tudo' ? valor : C.parseValor(f.get('parte')));
  if (!(parte > 0) || parte > valor) { toast('A parte dividida precisa ser maior que zero e até o valor total'); return null; }
  return { divisao, parte };
}

function formDivItem(x, tipo) {
  const c = conexaoAtiva(); if (!c) return;
  const eu = usuario.uid; const outro = outroDe(c); const nome = nomeOutro(c);
  const novo = !x;
  x = x || { descricao: '', valor: null, data: C.hojeISO(), categoria: 'Outros', pagou: tipo === 'devo' ? outro : eu, divisao: 'metade', parte: null };
  abrirModal(novo ? (tipo === 'devo' ? `Eu devo a ${nome}` : `${nome} me deve`) : 'Editar item dividido', `<form id="f">
    ${campoValor(x.valor, 'Valor total')}
    <label>Descrição</label><input name="descricao" required maxlength="80" autocomplete="off" placeholder="Ex.: Mercado, Pizza, Conta de luz" value="${esc(x.descricao)}">
    <div class="linha">
      <div><label>Data</label><input name="data" type="date" required value="${x.data}"></div>
      <div><label>Categoria</label><select name="categoria">${optsCategorias(x.categoria)}</select></div>
    </div>
    <label>Quem pagou</label><select name="pagou"><option value="${eu}" ${x.pagou === eu ? 'selected' : ''}>Eu</option><option value="${esc(outro)}" ${x.pagou === outro ? 'selected' : ''}>${esc(nome)}</option></select>
    ${camposDivisao(x.divisao, x.parte)}
    ${botoes(!novo)}
  </form>`);
  const form = $('#f');
  ligarDivisao(form, (f) => ({ nome, euDevo: f.get('pagou') !== eu }));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const valor = lerValor(f); if (valor === null) return;
    const div = lerDivisao(f, valor); if (!div) return;
    const pagou = f.get('pagou') === eu ? eu : outro;
    store.definirItem(c.id, x.id || store.novoId(), {
      descricao: f.get('descricao').trim(), valor, data: f.get('data'), categoria: f.get('categoria'), pagou, ...div,
      criadoPor: eu, criadoEm: x.criadoEm || Date.now(), pago: false, pagoEm: null, lancado: false,
    });
    fecharModal(); toast(novo ? '🤝 Item dividido lançado' : 'Item atualizado');
  });
  ligarExcluir(() => store.removerItem(c.id, x.id));
}

function abrirDivItem(id) {
  const x = divItens.find((i) => i.id === id); if (!x) return;
  const eu = usuario.uid; const meu = x.criadoPor === eu;
  const c = conexao(); const ativa = !!conexaoAtiva(); const nome = esc(nomeOutro(c));
  // Item que nasceu de um lançamento meu: edita pelo próprio lançamento.
  if (meu && ativa && !x.pago && x.lancado && x.origem) {
    const l = (D[x.origem.col] || []).find((y) => y.id === x.origem.id && !y.excluida);
    if (l) { (x.origem.col === 'compras' ? formCompra : formConta)(l); return; }
  }
  if (meu && ativa && !x.pago) { formDivItem(x); return; }
  abrirModal(x.descricao, `<div class="aviso" style="margin-top:4px">
    ${C.dataBR(x.data)} · ${C.catInfo(x.categoria).e} ${esc(x.categoria || 'Outros')}<br>
    Total <b>${fmt(x.valor)}</b>, pago por <b>${x.pagou === eu ? 'você' : nome}</b><br>
    ${x.pagou === eu ? `${nome} deve` : 'Você deve'} <b>${fmt(x.parte)}</b> · lançado por ${meu ? 'você' : nome}
    ${x.pago ? `<br>✅ Acertado em ${C.dataBR(x.pagoEm)}` : ''}</div>
    ${meu && ativa ? '<div class="acoes"><button type="button" class="btn danger" data-excluir>Excluir</button></div>' : ''}`);
  ligarExcluir(() => store.removerItem(c.id, x.id));
}

function acertarTudo() {
  const c = conexaoAtiva(); if (!c) return;
  const eu = usuario.uid; const outro = outroDe(c); const nome = esc(nomeOutro(c));
  const abertos = divItens.filter((x) => !x.pago);
  if (!abertos.length) { toast('Nada em aberto'); return; }
  const saldo = C.saldoDivisao(divItens, eu);
  abrirModal('Acertar tudo', `<div class="aviso" style="margin-top:4px">${saldo > 0 ? `<b>${nome}</b> paga <b>${fmt(saldo)}</b> para você` : saldo < 0 ? `Você paga <b>${fmt(-saldo)}</b> para <b>${nome}</b>` : 'Os valores se anulam: ninguém precisa pagar nada'}, e ${plural(abertos.length, 'item fica acertado', 'itens ficam acertados')}.<br>O pagamento em si (Pix, dinheiro) é feito fora do app.</div>
    <div class="acoes"><button class="btn" data-a="fechar-modal">Cancelar</button><button class="btn primary" id="div-ok">Registrar acerto</button></div>`);
  $('#div-ok').addEventListener('click', () => {
    store.acertar(c.id, { valor: Math.abs(saldo), de: saldo > 0 ? outro : eu, para: saldo > 0 ? eu : outro, itens: abertos.map((x) => x.id), n: abertos.length, data: C.hojeISO(), em: Date.now(), criadoPor: eu });
    fecharModal(); toast('🤝 Acerto registrado');
  });
}

function sairDivisao() {
  const c = conexao(); if (!c) return;
  const nome = esc(nomeOutro(c)); const ativa = c.membros.length === 2;
  abrirModal(ativa ? 'Desfazer conexão' : 'Apagar histórico', `<div class="aviso" style="margin-top:4px">${ativa
    ? `Você deixa de ver os itens com <b>${nome}</b>, e ${nome} deixa de ver o que você lançar. O histórico continua com ${nome} até ser apagado. Para dividir de novo, é preciso um convite novo.`
    : `Apaga todos os itens e acertos com <b>${nome}</b>. Não dá para desfazer.`}</div>
    <div class="acoes"><button class="btn" data-a="fechar-modal">Cancelar</button><button class="btn danger" id="div-sair-ok">${ativa ? 'Desfazer' : 'Apagar'}</button></div>`);
  $('#div-sair-ok').addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.ok !== '1') { b.dataset.ok = '1'; b.textContent = 'Toque de novo para confirmar'; return; }
    b.disabled = true;
    try {
      if (ativa) await store.sairConexao(c); else await store.apagarConexao(c.id);
      fecharModal(); toast(ativa ? 'Conexão desfeita' : 'Histórico apagado');
    } catch (e) { b.disabled = false; toast('Não deu certo: ' + (e.code || e.message || e)); }
  });
}

// Bloco "Dividir com Fulana" nos formulários de conta e compra (quem pagou é sempre você).
const itemLigado = (x) => { const c = conexaoAtiva(); return x && x.divItem && c && x.divCid === c.id ? divItens.find((i) => i.id === x.divItem) || null : null; };
function blocoDividir(x) {
  const c = conexaoAtiva(); if (!c) return '';
  const it = itemLigado(x); const nome = esc(nomeOutro(c));
  if (it && it.pago) return `<div class="aviso">🤝 Dividido com ${nome} (parte de ${nome}: ${fmt(it.parte)}). Já foi acertado, então a divisão não muda mais.</div>`;
  return `<label class="chk-l"><input type="checkbox" name="dividir" ${it ? 'checked' : ''}> 🤝 Dividir com ${nome}</label>
    <div data-div-campos>${camposDivisao(it ? it.divisao : 'metade', it ? it.parte : null)}</div>`;
}
function lerDividir(f, valor) {
  if (!conexaoAtiva() || f.get('dividir') !== 'on') return null;
  return lerDivisao(f, valor) || false;
}
// Grava (ou desfaz) o item compartilhado de um lançamento e devolve os campos que vão no lançamento.
function camposDividir(col, id, dados, antigo, div) {
  const c = conexaoAtiva();
  const ligado = itemLigado(antigo);
  if (ligado && ligado.pago) return {};
  if (!div) {
    if (ligado) store.removerItem(c.id, ligado.id);
    return ligado || (antigo && antigo.divItem && c && antigo.divCid === c.id) ? { parteOutro: null, divItem: null, divCid: null } : {};
  }
  const itemId = ligado ? ligado.id : store.novoId();
  store.definirItem(c.id, itemId, {
    descricao: dados.descricao, valor: dados.valor, data: dados.data, categoria: dados.categoria || 'Outros', pagou: usuario.uid, ...div,
    criadoPor: usuario.uid, criadoEm: ligado ? ligado.criadoEm : Date.now(), pago: false, pagoEm: null, lancado: true, origem: { col, id },
  });
  return { parteOutro: div.parte, divItem: itemId, divCid: c.id };
}
function desfazerDivisao(x) { const it = itemLigado(x); if (it && !it.pago) store.removerItem(conexaoAtiva().id, it.id); }

function abrirAtalho() {
  const acao = new URLSearchParams(location.search).get('acao'); if (!acao) return;
  history.replaceState(null, '', location.pathname);
  ({ compra: () => formCompra(), conta: () => formConta(), boleto: formBoleto, dividas: () => trocarTela('dividas') }[acao] || (() => {}))();
}

// ---------------- Eventos ----------------
const ACOES = {
  'novo-boleto': () => formBoleto(),
  'novo-financiamento': () => formFinanciamento(),
  'editar-financiamento': (id) => { const r = D.recorrentes.find((x) => x.id === id); if (r) formFinanciamento(r); },
  'importar-extrato': () => importarExtrato(),
  'conferir-fatura': (id) => conferirFatura(id),
  'copiar-codigo': (id) => { navigator.clipboard?.writeText(id).then(() => toast('Código copiado ✓'), () => toast('Não consegui copiar')); },
  hoje: () => { if (ym !== C.ymAtual()) { ym = C.ymAtual(); mudarMes(0); } },
  'mes-picker': () => seletorMes(),
  ano: (id) => seletorMes(Number(id)),
  'escolher-mes': (id) => { fecharModal(); if (id !== ym) { ym = id; diaSel = null; mudarMes(0); } },
  dia: (id) => { diaSel = diaSel === id ? null : id; render(); },
  recorrencias: gerenciarRecorrencias,
  exportar: () => exportar(),
  'exportar-planilha': () => exportarPlanilha(),
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
  'cfg-telegram': () => configTelegram(),
  'fechar-modal': () => fecharModal(),
  'ir-dividir': () => {
    if (tela !== 'dividir') divVoltar = tela;
    const c = conexao();
    divVistoAntes = c ? Number(localStorage.getItem(vistoKey(c.id))) || 0 : 0;
    trocarTela('dividir');
  },
  'div-convidar': () => gerarConvite(),
  'div-compartilhar': () => { const p = conviteSalvo(); if (p) compartilharConvite(p.cod); else render(); },
  'div-cancelar-convite': () => { const p = conviteSalvo(); if (p) store.cancelarConvite(p.cod).catch(() => {}); localStorage.removeItem('fin-convite'); render(); },
  'div-tenho-codigo': () => digitarCodigo(),
  'div-novo': (id) => formDivItem(null, id),
  'div-item': (id) => abrirDivItem(id),
  'div-pagar': (id) => {
    const c = conexaoAtiva(); const x = divItens.find((i) => i.id === id); if (!c || !x) return;
    const p = !x.pago;
    store.atualizarItem(c.id, id, { pago: p, pagoEm: p ? C.hojeISO() : null, pagoPor: p ? usuario.uid : null, acertoId: null });
    toast(p ? `"${x.descricao}" acertado ✓` : 'Voltou para em aberto');
  },
  'div-acertar': () => acertarTudo(),
  'div-sair': () => sairDivisao(),
  'div-sim-aceite': () => { const p = conviteSalvo(); if (p && store.simular) store.simular.aceite(p.cod); },
  'div-sim-item': () => { const c = conexaoAtiva(); if (c && store.simular) { store.simular.item(c.id); toast(`🧪 ${nomeOutro(c)} lançou um item`); } },
  'div-sim-sair': () => { const c = conexaoAtiva(); if (c && store.simular) store.simular.sair(c.id); },
  'cfg-inicio': () => configInicio(),
  'cfg-categorias': () => configCategorias(),
  ir: (id) => trocarTela(id),
  sub: (id) => { sub = id; render(); },
  novo: () => abrirLancar(),
  'lancar-aba': (id) => abrirLancar(id),
  'form-completo': menuNovo,
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
  fechar: () => fecharModal(),
  'renegociar-fatura': (id) => {
    const [cardId] = id.split('_');
    const card = carteira(cardId); if (card) renegociarFatura(C.faturaDe(D, card, id.slice(cardId.length + 1)));
  },
  'pagar-pendente': (id, el) => {
    if (el.dataset.tipo === 'fatura') { ACOES.pagar(id, el); return; }
    const c = D.contas.find((x) => x.id === id); if (!c) return;
    const antes = { pago: c.pago, pagoEm: c.pagoEm || null, carteiraId: c.carteiraId || null };
    store.atualizar('contas', c.id, { pago: true, pagoEm: C.hojeISO(), carteiraId: c.carteiraId || carteiraPadrao() });
    toast(`${c.descricao} paga`, () => store.atualizar('contas', c.id, antes));
  },
  saude: () => abrirModal('Saúde financeira', cardSaude()),
  pendentes: () => {
    const r = C.resumoMes(D, ym);
    const l = itensPendentes(r, P.projecao(D, 60, { comissoes: modCom() }), modCom() ? C.resumoComissoes(D, ym) : null);
    abrirModal('Precisa de você', `<div class="list g">${l.map(linhaPendente).join('')}</div>`);
  },
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
    if (e.target.matches('[data-plano]')) {
      const f = new FormData($('#f-plano'));
      salvarPrefs({ planoValor: C.parseValor(f.get('aporte')) || 0, planoEstrategia: f.get('estrategia') || 'avalanche' });
      return;
    }
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
