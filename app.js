import { criarStore, modoLocal } from './store.js';

const $ = (s) => document.querySelector(s);
const CATEGORIAS = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Cartão de crédito', 'Água/Luz/Internet', 'Impostos', 'Outros'];
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v) => brl.format(v || 0);
const pad = (n) => String(n).padStart(2, '0');
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ymAtual = () => hojeISO().slice(0, 7);
const soma = (arr) => Math.round(arr.reduce((s, x) => s + (Number(x.valor) || 0), 0) * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBR = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';

function somarMes(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function diaNoMes(ym, dia) {
  const [a, m] = ym.split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${ym}-${pad(Math.min(Number(dia) || 1, ultimo))}`;
}
function rotuloMes(ym) {
  const [a, m] = ym.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function diasAte(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const [ha, hm, hd] = hojeISO().split('-').map(Number);
  return Math.round((new Date(a, m - 1, d) - new Date(ha, hm - 1, hd)) / 86400000);
}
function parseValor(txt) {
  let s = String(txt).trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = Math.round(parseFloat(s) * 100) / 100;
  return isFinite(v) ? v : NaN;
}
const valorParaCampo = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));

// ---------------- Estado ----------------
let store;
let usuario = null;
let ym = ymAtual();
let aba = 'resumo';
let contas = [];
let entradas = [];
let recorrentes = [];
let mesDoServidor = false;
let recDoServidor = false;
let pararMes = null;
let pararRec = null;
const geradosNestaSessao = new Set();

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---------------- Inicialização ----------------
async function iniciar() {
  store = await criarStore();
  $('#btn-login').addEventListener('click', async () => {
    $('#login-erro').textContent = '';
    try { await store.entrar(); } catch (e) { $('#login-erro').textContent = 'Não foi possível entrar: ' + (e.code || e.message); }
  });
  if (modoLocal) $('#btn-login').textContent = 'Entrar (modo local de teste)';

  await store.init((u) => {
    usuario = u;
    if (u) mostrarApp(); else mostrarLogin();
  });
  store.assinarStatus((s) => { $('#sync-status').textContent = s; });
  ligarEventos();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function mostrarLogin() {
  if (pararMes) pararMes(); if (pararRec) pararRec();
  pararMes = pararRec = null;
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

function mostrarApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#menu-user').innerHTML = `${esc(usuario.displayName || '')}<br>${esc(usuario.email || '')}`;
  if (pararRec) pararRec();
  pararRec = store.assinarRecorrentes((lista, srv) => { recorrentes = lista; recDoServidor = srv; gerarRecorrentes(); render(); });
  carregarMes();
}

function carregarMes() {
  if (pararMes) pararMes();
  contas = []; entradas = []; mesDoServidor = false;
  $('#mes-label').textContent = rotuloMes(ym);
  render();
  pararMes = store.assinarMes(ym, (d) => {
    contas = d.contas; entradas = d.entradas; mesDoServidor = d.doServidor;
    gerarRecorrentes();
    render();
  });
}

// Cria, para o mês aberto, os lançamentos das recorrências que ainda não existem.
// Só roda com dados confirmados pelo servidor, para não sobrescrever nada.
function gerarRecorrentes() {
  if (!mesDoServidor || !recDoServidor) return;
  for (const r of recorrentes) {
    if (!r.inicio || r.inicio > ym) continue;
    if (r.fim && ym > r.fim) continue;
    const id = `${r.id}_${ym}`;
    const col = r.tipo === 'entrada' ? 'entradas' : 'contas';
    const lista = col === 'entradas' ? entradas : contas;
    if (lista.some((x) => x.id === id) || geradosNestaSessao.has(id)) continue;
    geradosNestaSessao.add(id);
    const doc = { descricao: r.descricao, valor: r.valor, data: diaNoMes(ym, r.dia), recorrenteId: r.id };
    if (col === 'contas') { doc.categoria = r.categoria || 'Outros'; doc.pago = false; doc.pagoEm = null; }
    store.definir(col, id, doc);
  }
}

// ---------------- Render ----------------
const visiveis = (l) => l.filter((x) => !x.excluida);

function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === aba));
  const el = $('#conteudo');
  if (aba === 'resumo') el.innerHTML = renderResumo();
  else if (aba === 'apagar') el.innerHTML = renderContas(false);
  else if (aba === 'pagas') el.innerHTML = renderContas(true);
  else el.innerHTML = renderEntradas();
}

function tagVencimento(c) {
  if (c.pago) return `<span class="tag green">Paga ${c.pagoEm ? 'em ' + dataBR(c.pagoEm) : ''}</span>`;
  const d = diasAte(c.data);
  if (d < 0) return `<span class="tag red">Vencida há ${-d} dia${d === -1 ? '' : 's'}</span>`;
  if (d === 0) return '<span class="tag amber">Vence hoje</span>';
  if (d <= 3) return `<span class="tag amber">Vence em ${d} dia${d === 1 ? '' : 's'}</span>`;
  return '';
}

function itemConta(c) {
  return `<div class="item">
    <button class="check ${c.pago ? 'on' : ''}" data-pagar="${c.id}" aria-label="${c.pago ? 'Desmarcar como paga' : 'Marcar como paga'}">${c.pago ? '✓' : ''}</button>
    <div class="info" data-editar-conta="${c.id}">
      <div class="desc">${esc(c.descricao)}</div>
      <div class="meta">Vence ${dataBR(c.data)} · ${esc(c.categoria || 'Outros')}${c.recorrenteId ? ' · 🔁' : ''} ${tagVencimento(c)}</div>
    </div>
    <div class="valor">${moeda(c.valor)}</div>
  </div>`;
}

function renderResumo() {
  const cs = visiveis(contas), es = visiveis(entradas);
  const entrou = soma(es);
  const pagas = cs.filter((c) => c.pago), abertas = cs.filter((c) => !c.pago);
  const pago = soma(pagas), aPagar = soma(abertas), total = soma(cs);
  const vencidas = abertas.filter((c) => diasAte(c.data) < 0);
  const sobra = Math.round((entrou - pago) * 100) / 100;
  const previsao = Math.round((entrou - total) * 100) / 100;
  const pct = total > 0 ? Math.round((pago / total) * 100) : 0;
  const cls = (v) => (v < 0 ? 'neg' : 'pos');

  const proximas = [...abertas].sort((a, b) => a.data.localeCompare(b.data)).slice(0, 5);
  const porCat = {};
  cs.forEach((c) => { const k = c.categoria || 'Outros'; porCat[k] = (porCat[k] || 0) + Number(c.valor || 0); });
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;

  return `
  <div class="cards">
    <div class="card destaque">
      <div class="lbl">Quanto sobrou até agora (entrou − pago)</div>
      <div class="val ${cls(sobra)}">${moeda(sobra)}</div>
      <div class="sub">Previsão para o fim do mês, pagando tudo: <b class="${cls(previsao)}">${moeda(previsao)}</b></div>
    </div>
    <div class="card"><div class="lbl">💰 Entrou</div><div class="val pos">${moeda(entrou)}</div><div class="sub">${es.length} entrada${es.length === 1 ? '' : 's'}</div></div>
    <div class="card"><div class="lbl">✅ Pago</div><div class="val">${moeda(pago)}</div><div class="sub">${pagas.length} conta${pagas.length === 1 ? '' : 's'}</div></div>
    <div class="card"><div class="lbl">🧾 A pagar</div><div class="val warn">${moeda(aPagar)}</div><div class="sub">${abertas.length} conta${abertas.length === 1 ? '' : 's'}</div></div>
    <div class="card"><div class="lbl">⚠️ Vencidas</div><div class="val ${vencidas.length ? 'neg' : ''}">${moeda(soma(vencidas))}</div><div class="sub">${vencidas.length} conta${vencidas.length === 1 ? '' : 's'}</div></div>
    <div class="card destaque">
      <div class="lbl">Contas do mês pagas: ${pct}% (${moeda(pago)} de ${moeda(total)})</div>
      <div class="barra"><div style="width:${pct}%"></div></div>
    </div>
  </div>
  <div class="secao"><h3>Próximos vencimentos</h3>
    ${proximas.length ? `<div class="lista">${proximas.map(itemConta).join('')}</div>` : '<div class="vazio">Nenhuma conta em aberto neste mês 🎉</div>'}
  </div>
  ${cats.length ? `<div class="secao"><h3>Contas por categoria</h3><div class="lista">
    ${cats.map(([k, v]) => `<div class="cat"><div class="cat-top"><span>${esc(k)}</span><b>${moeda(v)}</b></div><div class="barra"><div style="width:${Math.round((v / maxCat) * 100)}%"></div></div></div>`).join('')}
  </div></div>` : ''}`;
}

function renderContas(pagas) {
  let lista = visiveis(contas).filter((c) => !!c.pago === pagas);
  lista.sort(pagas ? (a, b) => (b.pagoEm || '').localeCompare(a.pagoEm || '') : (a, b) => a.data.localeCompare(b.data));
  if (!lista.length) {
    return `<div class="vazio">${pagas ? 'Nenhuma conta paga neste mês ainda.' : 'Nenhuma conta a pagar neste mês.<br>Toque em <b>+</b> para adicionar.'}</div>`;
  }
  return `<div class="total-linha"><span>${lista.length} conta${lista.length === 1 ? '' : 's'}</span><span>Total: <b>${moeda(soma(lista))}</b></span></div>
    <div class="lista">${lista.map(itemConta).join('')}</div>
    ${pagas ? '' : '<p class="sub" style="text-align:center;margin-top:12px">Toque no círculo para marcar como paga.</p>'}`;
}

function renderEntradas() {
  const lista = visiveis(entradas).sort((a, b) => a.data.localeCompare(b.data));
  if (!lista.length) return '<div class="vazio">Nenhuma entrada neste mês.<br>Toque em <b>+</b> para registrar salário e outros recebimentos.</div>';
  return `<div class="total-linha"><span>${lista.length} entrada${lista.length === 1 ? '' : 's'}</span><span>Total: <b>${moeda(soma(lista))}</b></span></div>
    <div class="lista">${lista.map((e) => `<div class="item">
      <div class="info" data-editar-entrada="${e.id}">
        <div class="desc">${esc(e.descricao)}</div>
        <div class="meta">${dataBR(e.data)}${e.recorrenteId ? ' · 🔁 todo mês' : ''}</div>
      </div>
      <div class="valor entrada">+ ${moeda(e.valor)}</div>
    </div>`).join('')}</div>`;
}

// ---------------- Modais / formulários ----------------
function abrirModal(titulo, html) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = html;
  $('#modal').classList.remove('hidden');
  const primeiro = $('#modal-corpo input');
  if (primeiro && window.matchMedia('(min-width: 600px)').matches) primeiro.focus();
}
const fecharModal = () => $('#modal').classList.add('hidden');

function dataPadrao() {
  return ym === ymAtual() ? hojeISO() : `${ym}-01`;
}

function formConta(c) {
  const novo = !c;
  c = c || { descricao: '', valor: null, data: dataPadrao(), categoria: 'Outros', pago: false };
  const rec = c.recorrenteId ? recorrentes.find((r) => r.id === c.recorrenteId) : null;
  abrirModal(novo ? 'Nova conta' : 'Editar conta', `
    <form id="f-conta">
      <label>Descrição</label>
      <input name="descricao" required maxlength="80" placeholder="Ex.: Aluguel, Luz, Cartão" value="${esc(c.descricao)}">
      <div class="linha">
        <div><label>Valor (R$)</label><input name="valor" required inputmode="decimal" placeholder="0,00" value="${valorParaCampo(c.valor)}"></div>
        <div><label>Vencimento</label><input name="data" type="date" required value="${c.data}"></div>
      </div>
      <label>Categoria</label>
      <select name="categoria">${CATEGORIAS.map((k) => `<option ${k === c.categoria ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" name="pago" ${c.pago ? 'checked' : ''}> Já está paga</label>
      ${novo ? '<label class="chk"><input type="checkbox" name="repetir"> Repetir todo mês (no mesmo dia)</label>' : ''}
      ${rec ? `<div class="aviso">🔁 Conta recorrente. Alterações aqui valem só para este mês.
        ${rec.fim ? `<br>Recorrência encerrada em ${rotuloMes(rec.fim)}.` : '<br><button type="button" class="btn" style="margin-top:8px;width:100%" id="b-parar">Parar de repetir depois deste mês</button>'}</div>` : ''}
      <div class="acoes">
        ${novo ? '' : '<button type="button" class="btn danger" id="b-excluir">Excluir</button>'}
        <button class="btn primary">Salvar</button>
      </div>
    </form>`);

  $('#f-conta').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const valor = parseValor(f.get('valor'));
    if (!(valor > 0)) { toast('Informe um valor válido'); return; }
    const pago = f.get('pago') === 'on';
    const dados = {
      descricao: f.get('descricao').trim(), valor, data: f.get('data'), categoria: f.get('categoria'),
      pago, pagoEm: pago ? (c.pagoEm || hojeISO()) : null,
    };
    if (novo && f.get('repetir') === 'on') {
      const recId = store.novoId();
      const mesConta = dados.data.slice(0, 7);
      store.definir('recorrentes', recId, { tipo: 'conta', descricao: dados.descricao, valor, categoria: dados.categoria, dia: Number(dados.data.slice(8, 10)), inicio: mesConta, fim: null });
      store.definir('contas', `${recId}_${mesConta}`, { ...dados, recorrenteId: recId });
      geradosNestaSessao.add(`${recId}_${mesConta}`);
    } else if (novo) {
      store.adicionar('contas', dados);
    } else {
      store.atualizar('contas', c.id, dados);
    }
    fecharModal();
    toast(novo ? 'Conta adicionada' : 'Conta atualizada');
    if (dados.data.slice(0, 7) !== ym) toast('Salva em ' + rotuloMes(dados.data.slice(0, 7)));
  });
  ligarExcluir('contas', c);
  const bp = $('#b-parar');
  if (bp) bp.addEventListener('click', () => { store.atualizar('recorrentes', rec.id, { fim: ym }); fecharModal(); toast('Não vai mais repetir após ' + rotuloMes(ym)); });
}

function formEntrada(e) {
  const novo = !e;
  e = e || { descricao: '', valor: null, data: dataPadrao() };
  const rec = e.recorrenteId ? recorrentes.find((r) => r.id === e.recorrenteId) : null;
  abrirModal(novo ? 'Nova entrada' : 'Editar entrada', `
    <form id="f-entrada">
      <label>Descrição</label>
      <input name="descricao" required maxlength="80" placeholder="Ex.: Salário, Freela, Pix recebido" value="${esc(e.descricao)}">
      <div class="linha">
        <div><label>Valor (R$)</label><input name="valor" required inputmode="decimal" placeholder="0,00" value="${valorParaCampo(e.valor)}"></div>
        <div><label>Data</label><input name="data" type="date" required value="${e.data}"></div>
      </div>
      ${novo ? '<label class="chk"><input type="checkbox" name="repetir"> Repetir todo mês (ex.: salário)</label>' : ''}
      ${rec ? `<div class="aviso">🔁 Entrada recorrente. Alterações aqui valem só para este mês.
        ${rec.fim ? `<br>Recorrência encerrada em ${rotuloMes(rec.fim)}.` : '<br><button type="button" class="btn" style="margin-top:8px;width:100%" id="b-parar">Parar de repetir depois deste mês</button>'}</div>` : ''}
      <div class="acoes">
        ${novo ? '' : '<button type="button" class="btn danger" id="b-excluir">Excluir</button>'}
        <button class="btn primary">Salvar</button>
      </div>
    </form>`);

  $('#f-entrada').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const valor = parseValor(f.get('valor'));
    if (!(valor > 0)) { toast('Informe um valor válido'); return; }
    const dados = { descricao: f.get('descricao').trim(), valor, data: f.get('data') };
    if (novo && f.get('repetir') === 'on') {
      const recId = store.novoId();
      const mes = dados.data.slice(0, 7);
      store.definir('recorrentes', recId, { tipo: 'entrada', descricao: dados.descricao, valor, dia: Number(dados.data.slice(8, 10)), inicio: mes, fim: null });
      store.definir('entradas', `${recId}_${mes}`, { ...dados, recorrenteId: recId });
      geradosNestaSessao.add(`${recId}_${mes}`);
    } else if (novo) {
      store.adicionar('entradas', dados);
    } else {
      store.atualizar('entradas', e.id, dados);
    }
    fecharModal();
    toast(novo ? 'Entrada registrada' : 'Entrada atualizada');
  });
  ligarExcluir('entradas', e);
  const bp = $('#b-parar');
  if (bp) bp.addEventListener('click', () => { store.atualizar('recorrentes', rec.id, { fim: ym }); fecharModal(); toast('Não vai mais repetir após ' + rotuloMes(ym)); });
}

function ligarExcluir(col, item) {
  const b = $('#b-excluir');
  if (!b) return;
  b.addEventListener('click', () => {
    if (b.dataset.confirma !== '1') { b.dataset.confirma = '1'; b.textContent = 'Toque de novo para excluir'; return; }
    // Lançamento recorrente: marca como excluído, para não ser recriado neste mês.
    if (item.recorrenteId) store.atualizar(col, item.id, { excluida: true });
    else store.remover(col, item.id);
    fecharModal();
    toast('Excluído');
  });
}

function gerenciarRecorrencias() {
  $('#menu').classList.add('hidden');
  const ativas = recorrentes.filter((r) => !r.fim || r.fim >= ymAtual());
  const html = ativas.length ? `<div class="lista">${ativas.map((r) => `<div class="item">
      <div class="info"><div class="desc">${esc(r.descricao)}</div>
      <div class="meta">${r.tipo === 'entrada' ? 'Entrada' : 'Conta'} · todo dia ${r.dia} · desde ${rotuloMes(r.inicio)}${r.fim ? ' · até ' + rotuloMes(r.fim) : ''}</div></div>
      <div class="valor ${r.tipo === 'entrada' ? 'entrada' : ''}">${moeda(r.valor)}</div>
      ${r.fim ? '' : `<button class="btn danger" style="flex:0" data-encerrar="${r.id}">Encerrar</button>`}
    </div>`).join('')}</div>
    <p class="aviso">Encerrar mantém os lançamentos já criados e para de criar a partir do mês seguinte ao que você está vendo (${rotuloMes(ym)}).<br>O valor novo de uma recorrência: encerre a antiga e crie outra.</p>`
    : '<div class="vazio">Nenhuma recorrência ativa. Ao criar uma conta ou entrada, marque "Repetir todo mês".</div>';
  abrirModal('Recorrências', html);
  document.querySelectorAll('[data-encerrar]').forEach((b) => b.addEventListener('click', () => {
    store.atualizar('recorrentes', b.dataset.encerrar, { fim: ym });
    fecharModal(); toast('Recorrência encerrada');
  }));
}

async function exportar() {
  $('#menu').classList.add('hidden');
  const dados = await store.exportarTudo();
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `financas-backup-${hojeISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------- Eventos ----------------
function ligarEventos() {
  $('#mes-ant').addEventListener('click', () => { ym = somarMes(ym, -1); carregarMes(); });
  $('#mes-prox').addEventListener('click', () => { ym = somarMes(ym, 1); carregarMes(); });
  $('#btn-menu').addEventListener('click', (e) => { e.stopPropagation(); $('#menu').classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu')) $('#menu').classList.add('hidden'); });
  $('#btn-hoje').addEventListener('click', () => { $('#menu').classList.add('hidden'); ym = ymAtual(); carregarMes(); });
  $('#btn-recorrentes').addEventListener('click', gerenciarRecorrencias);
  $('#btn-exportar').addEventListener('click', exportar);
  $('#btn-sair').addEventListener('click', () => { $('#menu').classList.add('hidden'); store.sair(); });

  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => { aba = b.dataset.tab; render(); window.scrollTo(0, 0); }));
  $('#fab').addEventListener('click', () => (aba === 'entradas' ? formEntrada() : formConta()));
  $('#modal-fechar').addEventListener('click', fecharModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });

  $('#conteudo').addEventListener('click', (e) => {
    const p = e.target.closest('[data-pagar]');
    if (p) {
      const c = contas.find((x) => x.id === p.dataset.pagar);
      if (c) {
        store.atualizar('contas', c.id, { pago: !c.pago, pagoEm: c.pago ? null : hojeISO() });
        toast(c.pago ? 'Voltou para "a pagar"' : `"${c.descricao}" marcada como paga`);
      }
      return;
    }
    const ec = e.target.closest('[data-editar-conta]');
    if (ec) { const c = contas.find((x) => x.id === ec.dataset.editarConta); if (c) formConta(c); return; }
    const ee = e.target.closest('[data-editar-entrada]');
    if (ee) { const x = entradas.find((y) => y.id === ee.dataset.editarEntrada); if (x) formEntrada(x); }
  });
}

iniciar();
