// Bot do Telegram · Minhas Finanças (@violinhabot) — Google Apps Script
// Acessa o Firestore com a sua própria conta Google (sem chave secreta).
// Configuração: abra a URL do app da Web, cole o token do @BotFather e toque no link de /start.

var PROJETO = 'minhas-financas-1ed86';
var UID_DONO = 'eKcRXnGu6FbpMVUTkHOqMptwDPX2';
var UID = UID_DONO; // trocado a cada mensagem para o perfil de quem escreveu
var BOT_USER = 'violinhabot';
var PROPS = PropertiesService.getScriptProperties();

var CATS = ['Alimentação', 'Restaurantes', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Compras', 'Assinaturas', 'Água/Luz/Internet', 'Moradia', 'Impostos', 'Outros'];
var REGRAS = [
  [/uber|99|cabify|posto|gasolina|combust|estacion|pedagio|onibus|metro|bilhete/, 'Transporte'],
  [/ifood|restaurante|lanche|lanchonete|burger|mc ?donald|pizza|salgado|coxinha|pastel|cafe|acai|sorvete|\bbar\b|cerveja|almoco|janta|marmita|sushi/, 'Restaurantes'],
  [/mercado|supermerc|padaria|feira|hortifruti|acougue|atacad|assai|carrefour|\bpao\b/, 'Alimentação'],
  [/netflix|spotify|youtube|disney|hbo|prime|deezer|apple|google one|icloud|claude|chatgpt|duolingo|meli|globoplay/, 'Assinaturas'],
  [/farmacia|remedio|drogaria|medico|consulta|exame|dentista|hospital|academia|petlove/, 'Saúde'],
  [/aluguel|condominio|iptu|\bluz\b|\bagua\b|\bgas\b/, 'Moradia'],
  [/vivo|claro|\btim\b|internet|celular|telefone/, 'Água/Luz/Internet'],
  [/curso|livro|escola|faculdade|udemy|alura/, 'Educação'],
  [/cinema|show|ingresso|jogo|steam|viagem|hotel|airbnb|passeio/, 'Lazer'],
  [/roupa|tenis|camisa|shopee|amazon|mercado ?livre|shein|loja|presente|riachuelo|renner/, 'Compras']
];
var PARADAS = ['no', 'na', 'do', 'da', 'de', 'em', 'com', 'cartao', 'credito', 'debito', 'pix', 'paguei', 'gastei', 'comprei', 'recebi', 'entrada', 'ganhei', 'reais', 'r', 'hoje', 'ontem', 'conta', 'pelo', 'pela', 'um', 'uma', 'o', 'a', 'mp'];
var GENERICAS = ['linha', 'credito', 'gold', 'platinum', 'conta', 'cartao', 'de', 'do', 'da'];
var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function pad(n) { return ('0' + n).slice(-2); }
function brl(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function hojeSP(delta) { return Utilities.formatDate(new Date(Date.now() + (delta || 0) * 86400000), 'America/Sao_Paulo', 'yyyy-MM-dd'); }
function mesFatura(card, data) {
  var fech = Number(card.fechamento) || 1, venc = Number(card.vencimento) || 10;
  var y = Number(data.slice(0, 4)), m = Number(data.slice(5, 7)), d = Number(data.slice(8, 10));
  if (d >= fech) m++;
  if (venc <= fech) m++;
  while (m > 12) { m -= 12; y++; }
  return MESES[m - 1] + '/' + String(y).slice(2);
}

// ---------------- Firestore (com a sua conta) ----------------
function fsReq(metodo, caminho, corpo) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJETO + '/databases/(default)/documents/usuarios/' + UID + '/' + caminho;
  var op = { method: metodo, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJETO } };
  if (corpo) { op.contentType = 'application/json'; op.payload = JSON.stringify(corpo); }
  var r = UrlFetchApp.fetch(url, op);
  if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 250));
  return metodo === 'delete' ? null : JSON.parse(r.getContentText() || '{}');
}
function paraFS(obj) {
  var f = {};
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v === null || v === undefined) f[k] = { nullValue: null };
    else if (typeof v === 'boolean') f[k] = { booleanValue: v };
    else if (typeof v === 'number') f[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else f[k] = { stringValue: String(v) };
  });
  return { fields: f };
}
function deFS(doc) {
  var o = { id: doc.name.split('/').pop() };
  var fl = doc.fields || {};
  Object.keys(fl).forEach(function (k) {
    var v = fl[k];
    o[k] = v.stringValue !== undefined ? v.stringValue : v.doubleValue !== undefined ? Number(v.doubleValue) : v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue !== undefined ? v.booleanValue : null;
  });
  return o;
}
function listar(col) { return (fsReq('get', col + '?pageSize=300').documents || []).map(deFS); }

// ---------------- Telegram ----------------
function tg(metodo, dados) {
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + PROPS.getProperty('BOT_TOKEN') + '/' + metodo, { method: 'post', contentType: 'application/json', payload: JSON.stringify(dados), muteHttpExceptions: true });
  return JSON.parse(r.getContentText() || '{}');
}
function responder(chat, texto, botoes) {
  var d = { chat_id: chat, text: texto, parse_mode: 'HTML' };
  if (botoes) d.reply_markup = { inline_keyboard: botoes };
  return tg('sendMessage', d);
}

var AJUDA = '<b>Como lançar</b> (é só escrever):\n' +
  '• <code>5,50 salgado nubank</code> → compra no cartão\n' +
  '• <code>120 tênis inter 3x</code> → R$ 120 em 3x\n' +
  '• <code>pix 50 mercado itaú</code> → pago da conta\n' +
  '• <code>débito 30 padaria nubank</code> → pago da conta\n' +
  '• <code>recebi 1800 seguro nubank</code> → entrada\n' +
  '• <code>ontem 40 ifood nubank</code> ou <code>12/11 ...</code> → outra data\n\n' +
  'Depois é só tocar em <b>Mudar categoria</b> ou <b>Desfazer</b>.\nComandos: /ajuda · /contas';

// ---------------- Interpretação ----------------
function interpretar(texto, carteiras) {
  var t = norm(texto).replace(/r\$\s*/g, '');
  var tipo = 'compra';
  if (/^(recebi|entrada|ganhei|caiu|salario)\b/.test(t)) tipo = 'entrada';
  else if (/\b(pix|debito|boleto)\b/.test(t)) tipo = 'conta';
  var data = hojeSP(0);
  if (/\bontem\b/.test(t)) data = hojeSP(-1);
  var resto = t;
  var dm = t.match(/\b(\d{1,2})\/(\d{1,2})\b(?!\d)/);
  if (dm) { data = hojeSP(0).slice(0, 4) + '-' + pad(dm[2]) + '-' + pad(dm[1]); resto = resto.replace(dm[0], ' '); }
  var pm = resto.match(/\b(\d{1,2})\s*x\b/); var parcelas = pm ? Number(pm[1]) : 1; if (pm) resto = resto.replace(pm[0], ' ');
  var vm = resto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!vm) return { erro: 'Não achei o valor. Ex.: <code>5,50 salgado nubank</code>' };
  var vs = vm[1];
  vs = vs.indexOf(',') >= 0 ? vs.replace(/\./g, '').replace(',', '.') : (/^\d{1,3}(\.\d{3})+$/.test(vs) ? vs.replace(/\./g, '') : vs);
  var valor = Math.round(parseFloat(vs) * 100) / 100;
  if (!(valor > 0)) return { erro: 'Valor inválido.' };
  resto = resto.replace(vm[1], ' ');
  var tokens = resto.split(/[^a-z0-9+]+/).filter(Boolean);
  var quer = tipo === 'compra' ? 'cartao' : 'conta';
  var cands = carteiras.map(function (c) {
    var pal = norm(c.nome).split(/[^a-z0-9+]+/).filter(function (w) { return w.length >= 2 && GENERICAS.indexOf(w) < 0; });
    var hits = pal.filter(function (w) { return tokens.indexOf(w) >= 0 || (w === 'mercado' && tokens.indexOf('mp') >= 0); });
    return { c: c, score: hits.length };
  }).filter(function (x) { return x.score > 0; });
  cands.sort(function (a, b) { return b.score - a.score || ((b.c.tipo === quer) - (a.c.tipo === quer)); });
  var cart = cands.length ? cands[0].c : null;
  if (cart && tipo === 'compra' && cart.tipo !== 'cartao') tipo = 'conta';
  if (cart && tipo === 'conta' && cart.tipo === 'cartao') tipo = 'compra';
  var usados = cart ? norm(cart.nome).split(/[^a-z0-9+]+/).filter(Boolean) : [];
  var desc = tokens.filter(function (w) { return usados.indexOf(w) < 0 && PARADAS.indexOf(w) < 0; });
  var descricao = texto.split(/\s+/).filter(function (w) { return desc.indexOf(norm(w).replace(/[^a-z0-9+]/g, '')) >= 0; }).join(' ').trim();
  var nd = norm(descricao + ' ' + texto);
  var categoria = 'Outros';
  for (var i = 0; i < REGRAS.length; i++) if (REGRAS[i][0].test(nd)) { categoria = REGRAS[i][1]; break; }
  if (!descricao) descricao = categoria;
  descricao = descricao.charAt(0).toUpperCase() + descricao.slice(1);
  return { tipo: tipo, valor: valor, data: data, parcelas: parcelas, cart: cart, descricao: descricao, categoria: categoria };
}

function lancar(chat, texto) {
  var carteiras = listar('carteiras');
  var x = interpretar(texto, carteiras);
  if (x.erro) return responder(chat, x.erro + '\n\n/ajuda');
  if (!x.cart && x.tipo !== 'entrada') {
    return responder(chat, 'Não identifiquei o cartão ou a conta. Escreva o nome junto, ex.: <code>' + texto + ' nubank</code>\n\nSeus cartões e contas:\n' + carteiras.map(function (c) { return '• ' + c.nome; }).join('\n'));
  }
  return gravar(chat, x);
}

var COLS = { p: 'compras', c: 'contas', e: 'entradas' };
function callback(q) {
  var p = q.data.split(':'); var acao = p[0], col = COLS[p[1]], id = p[2];
  if (['ok', 'no', 'tc', 'pc'].indexOf(acao) >= 0) return callbackFoto(q, p);
  var chat = q.message.chat.id, msg = q.message.message_id;
  if (acao === 'del') {
    fsReq('delete', col + '/' + id);
    tg('editMessageText', { chat_id: chat, message_id: msg, text: '↩️ Lançamento desfeito.' });
  } else if (acao === 'cat') {
    var linhas = [];
    for (var i = 0; i < CATS.length; i += 3) linhas.push(CATS.slice(i, i + 3).map(function (c, j) { return { text: c, callback_data: 'set:' + p[1] + ':' + id + ':' + (i + j) }; }));
    tg('editMessageReplyMarkup', { chat_id: chat, message_id: msg, reply_markup: { inline_keyboard: linhas } });
  } else if (acao === 'set') {
    var cat = CATS[Number(p[3])];
    fsReq('patch', col + '/' + id + '?updateMask.fieldPaths=categoria', paraFS({ categoria: cat }));
    tg('editMessageText', { chat_id: chat, message_id: msg, text: q.message.text.replace(/🏷️ .*$/m, '🏷️ ' + cat), reply_markup: { inline_keyboard: [[{ text: '🏷️ Mudar categoria', callback_data: 'cat:' + p[1] + ':' + id }, { text: '↩️ Desfazer', callback_data: 'del:' + p[1] + ':' + id }]] } });
  }
  tg('answerCallbackQuery', { callback_query_id: q.id });
}

// ---------------- Web app ----------------
function pagina(corpo) {
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:system-ui;max-width:440px;margin:24px auto;padding:0 16px;line-height:1.5">' + corpo + '</div>').setTitle('Bot Minhas Finanças');
}
function codigoPareamento() {
  var c = PROPS.getProperty('PAREAMENTO');
  if (!c) { c = String(Math.floor(100000 + Math.random() * 900000)); PROPS.setProperty('PAREAMENTO', c); }
  return c;
}
function doGet() {
  if (!PROPS.getProperty('BOT_TOKEN')) {
    return pagina('<h2>🤖 Configurar o bot</h2><p>1. No Telegram, abra <b>@BotFather</b> → /mybots → @' + BOT_USER + ' → <b>API Token</b> e copie.</p><p>2. Cole aqui:</p>' +
      '<form method="post" target="_top" action="' + ScriptApp.getService().getUrl() + '"><input type="hidden" name="acao" value="setup"><input name="token" placeholder="123456:ABC..." style="width:100%;padding:12px;font-size:16px" required><button style="margin-top:12px;width:100%;padding:12px;font-size:16px">Salvar e conectar</button></form>');
  }
  if (!PROPS.getProperty('ALLOWED_CHAT')) {
    return pagina('<h2>Quase lá ✅</h2><p>Toque no link abaixo e depois em <b>Iniciar</b> no Telegram para liberar o bot só para você:</p><p><a target="_blank" style="font-size:18px" href="https://t.me/' + BOT_USER + '?start=' + codigoPareamento() + '">Abrir @' + BOT_USER + '</a></p>');
  }
  return pagina('<h2>✅ Bot funcionando</h2><p>Mande gastos para @' + BOT_USER + ' no Telegram.</p>');
}
function doPost(e) {
  var ok = ContentService.createTextOutput('ok');
  if (e.parameter && e.parameter.acao === 'setup') {
    if (PROPS.getProperty('BOT_TOKEN')) return pagina('Já configurado.');
    PROPS.setProperty('BOT_TOKEN', String(e.parameter.token || '').trim());
    var segredo = Utilities.getUuid().replace(/-/g, '');
    PROPS.setProperty('SEGREDO', segredo);
    var r = tg('setWebhook', { url: ScriptApp.getService().getUrl() + '?k=' + segredo, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    if (!r.ok) { PROPS.deleteProperty('BOT_TOKEN'); return pagina('<p>❌ Token não aceito pelo Telegram: ' + (r.description || '') + '</p><p><a href="' + ScriptApp.getService().getUrl() + '">Tentar de novo</a></p>'); }
    tg('setMyCommands', { commands: [{ command: 'ajuda', description: 'Como lançar gastos' }, { command: 'contas', description: 'Seus cartões e contas' }] });
    return pagina('<h2>Conectado ✅</h2><p>Agora toque no link e depois em <b>Iniciar</b> no Telegram:</p><p><a target="_blank" style="font-size:18px" href="https://t.me/' + BOT_USER + '?start=' + codigoPareamento() + '">Abrir @' + BOT_USER + '</a></p>');
  }
  console.log('doPost: tem k=' + !!(e.parameter && e.parameter.k) + ' | k confere=' + (e.parameter && e.parameter.k === PROPS.getProperty('SEGREDO')));
  if (!e.parameter || e.parameter.k !== PROPS.getProperty('SEGREDO')) return ok;
  var up = JSON.parse(e.postData.contents);
  var cache = CacheService.getScriptCache();
  if (cache.get('u' + up.update_id)) return ok; // o Telegram reenvia; processa uma vez só
  cache.put('u' + up.update_id, '1', 21600);
  processar(up);
  return ok;
}

// Rode uma vez no editor para autorizar o acesso ao Firestore e testar a leitura.
function testarAcesso() { Logger.log(listar('carteiras').map(function (c) { return c.nome; }).join(', ')); }


// Diagnóstico: mostra o estado do webhook (sem expor o token).
function diagnostico() {
  var info = tg('getWebhookInfo', {}).result || {};
  Logger.log('webhook configurado: ' + (info.url ? info.url.replace(/k=[^&]+/, 'k=***').slice(0, 60) + '...' : 'NÃO'));
  Logger.log('pendentes: ' + info.pending_update_count + ' | último erro: ' + (info.last_error_message || 'nenhum') + ' | quando: ' + (info.last_error_date ? new Date(info.last_error_date * 1000) : '-'));
  Logger.log('chat liberado: ' + (PROPS.getProperty('ALLOWED_CHAT') ? 'sim' : 'não') + ' | segredo: ' + (PROPS.getProperty('SEGREDO') ? 'ok' : 'falta') + ' | url atual: ' + ScriptApp.getService().getUrl());
}

function processar(up) {
  var chat = up.message ? up.message.chat.id : (up.callback_query ? up.callback_query.message.chat.id : null);
  var texto = up.message && up.message.text ? up.message.text.trim() : '';
  console.log('update ' + up.update_id + ' | chat ' + chat + ' | texto: ' + texto.slice(0, 40) + ' | liberado: ' + PROPS.getProperty('ALLOWED_CHAT'));
  try {
    var permitido = PROPS.getProperty('ALLOWED_CHAT');
    if (/^\/start/.test(texto)) {
      var cod = texto.split(' ')[1];
      if (cod && /^v[a-z0-9]{12,}$/.test(cod)) { vincularChat(chat, cod, up.message.from); return; }
      if (!permitido && (!cod || cod === PROPS.getProperty('PAREAMENTO'))) { PROPS.setProperty('ALLOWED_CHAT', String(chat)); permitido = String(chat); }
      var ok = String(chat) === permitido || !!chatsVinculados()[String(chat)];
      var rr = responder(chat, ok ? '👋 Bot liberado para você!\n\n' + AJUDA : '🔒 Para usar o bot, abra o app Minhas Finanças → Perfil → <b>Conectar Telegram</b>.');
      console.log('resposta do Telegram: ' + JSON.stringify(rr).slice(0, 200));
      return;
    }
    var uid = uidDoChat(chat);
    if (!uid) { if (up.message) responder(chat, '🔒 Para usar o bot, abra o app Minhas Finanças → Perfil → <b>Conectar Telegram</b>.'); return; }
    UID = uid;
    if (texto === '/sair') { desvincularChat(chat); return; }
    if (up.callback_query) callback(up.callback_query);
    else if (texto === '/ajuda' || texto === '/help') responder(chat, AJUDA);
    else if (comandoConsulta(chat, texto)) { }
    else if (texto === '/contas') responder(chat, listar('carteiras').map(function (c) { return (c.tipo === 'cartao' ? '💳 ' : '🏦 ') + c.nome; }).join('\n') || 'Nenhuma cadastrada.');
    else if (texto) lancar(chat, texto);
    else if (up.message && (up.message.photo || (up.message.document && /image|pdf/.test(up.message.document.mime_type || '')))) lerFoto(chat, up.message);
    else if (up.message) responder(chat, '📷 Ainda não consigo ler fotos, áudios ou arquivos. Por enquanto, escreva o gasto em texto, por exemplo:\n<code>5,50 salgado nubank</code>\n\n/ajuda');
  } catch (err) {
    if (chat) responder(chat, '⚠️ Erro: ' + String(err.message || err).slice(0, 300));
  }
}

// ---------------- Vários usuários ----------------
// Cada pessoa conecta o próprio Telegram pelo app (Perfil → Conectar Telegram).
// O app grava vinculos/{código} = { uid, expira }; o bot liga o chat ao uid e apaga o código.
function chatsVinculados() { try { return JSON.parse(PROPS.getProperty('CHATS') || '{}'); } catch (e) { return {}; } }
function uidDoChat(chat) {
  if (String(chat) === PROPS.getProperty('ALLOWED_CHAT')) return UID_DONO;
  var v = chatsVinculados()[String(chat)];
  return v ? v.uid : null;
}
function fsRaiz(metodo, caminho, corpo) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + PROJETO + '/databases/(default)/documents/' + caminho;
  var op = { method: metodo, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJETO } };
  if (corpo) { op.contentType = 'application/json'; op.payload = JSON.stringify(corpo); }
  var r = UrlFetchApp.fetch(url, op);
  return { code: r.getResponseCode(), body: r.getContentText() ? JSON.parse(r.getContentText()) : {} };
}
function vincularChat(chat, cod, from) {
  var r = fsRaiz('get', 'vinculos/' + cod);
  if (r.code === 404) return responder(chat, '⚠️ Código inválido ou já usado. Gere outro no app: Perfil → Conectar Telegram.');
  if (r.code >= 300) return responder(chat, '⚠️ Erro ao conectar (' + r.code + '). Tente de novo.');
  var v = deFS(r.body);
  fsRaiz('delete', 'vinculos/' + cod);
  if (!v.uid || Number(v.expira || 0) < Date.now()) return responder(chat, '⌛ Código expirou. Gere outro no app: Perfil → Conectar Telegram.');
  if (String(chat) === PROPS.getProperty('ALLOWED_CHAT') && v.uid !== UID_DONO) return responder(chat, '⚠️ Este Telegram já é o dono do bot e não pode ser ligado a outra conta.');
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var m = chatsVinculados();
    m[String(chat)] = { uid: v.uid, nome: (from && from.first_name) || '', desde: hojeSP() };
    PROPS.setProperty('CHATS', JSON.stringify(m));
  } finally { lock.releaseLock(); }
  UID = v.uid;
  try { fsReq('patch', 'config/telegram', paraFS({ conectado: true, desde: hojeSP() })); } catch (e) {}
  responder(chat, '✅ Telegram conectado ao seu perfil!\n\n' + AJUDA);
}
function desvincularChat(chat) {
  if (String(chat) === PROPS.getProperty('ALLOWED_CHAT')) return responder(chat, 'Você é o dono do bot; não dá para desconectar por aqui.');
  var m = chatsVinculados(); delete m[String(chat)]; PROPS.setProperty('CHATS', JSON.stringify(m));
  try { fsReq('patch', 'config/telegram', paraFS({ conectado: false })); } catch (e) {}
  responder(chat, '👋 Telegram desconectado. Para voltar, use Perfil → Conectar Telegram no app.');
}
function listarVinculos() { Logger.log(JSON.stringify(chatsVinculados())); }

// Busca as mensagens novas no Telegram (rodado a cada minuto por um acionador).
function poll() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return;
  if (PROPS.getProperty('PERFIL_V') !== '2') { try { configurarPerfilBot(); PROPS.setProperty('PERFIL_V', '2'); } catch (e) { console.log('perfil: ' + e.message); } }
  try {
    var offset = Number(PROPS.getProperty('OFFSET') || 0);
    var r = tg('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    (r.result || []).forEach(function (up) {
      PROPS.setProperty('OFFSET', String(up.update_id + 1));
      var cache = CacheService.getScriptCache();
      if (cache.get('u' + up.update_id)) return;
      cache.put('u' + up.update_id, '1', 21600);
      processar(up);
    });
  } finally { lock.releaseLock(); }
}

// Rode uma vez: desliga o webhook (que o Google não suporta bem) para usar a busca a cada minuto.
function migrarParaPolling() {
  Logger.log(JSON.stringify(tg('deleteWebhook', { drop_pending_updates: false })));
  poll();
  Logger.log('chat liberado: ' + (PROPS.getProperty('ALLOWED_CHAT') ? 'sim' : 'não'));
}


function gravar(chat, x) {
  var col, doc, linha, cod;
  if (x.tipo === 'compra') {
    col = 'compras'; cod = 'p';
    doc = { carteiraId: x.cart.id, descricao: x.descricao, valor: x.valor, data: x.data, parcelas: x.parcelas, categoria: x.categoria, origem: 'telegram' };
    linha = '💳 <b>' + brl(x.valor) + '</b>' + (x.parcelas > 1 ? ' em ' + x.parcelas + 'x de ' + brl(x.valor / x.parcelas) : '') + ' · ' + x.descricao + '\n' + x.cart.nome + ' · fatura de ' + mesFatura(x.cart, x.data);
  } else if (x.tipo === 'conta') {
    col = 'contas'; cod = 'c';
    doc = { descricao: x.descricao, valor: x.valor, data: x.data, categoria: x.categoria, carteiraId: x.cart.id, pago: true, pagoEm: x.data, origem: 'telegram' };
    linha = '🏦 <b>' + brl(x.valor) + '</b> · ' + x.descricao + '\nPago com ' + x.cart.nome;
  } else {
    col = 'entradas'; cod = 'e';
    doc = { descricao: x.descricao, valor: x.valor, data: x.data, carteiraId: x.cart ? x.cart.id : null, origem: 'telegram' };
    linha = '💰 <b>+ ' + brl(x.valor) + '</b> · ' + x.descricao + (x.cart ? '\nEm ' + x.cart.nome : '');
  }
  var criado = fsReq('post', col, paraFS(doc));
  var id = criado.name.split('/').pop();
  var botoes = col === 'entradas' ? [[{ text: '↩️ Desfazer', callback_data: 'del:' + cod + ':' + id }]]
    : [[{ text: '🏷️ Mudar categoria', callback_data: 'cat:' + cod + ':' + id }, { text: '↩️ Desfazer', callback_data: 'del:' + cod + ':' + id }]];
  var dataTxt = x.data !== hojeSP(0) ? ' · ' + x.data.slice(8) + '/' + x.data.slice(5, 7) : '';
  return responder(chat, '✅ Lançado\n' + linha + '\n🏷️ ' + (col === 'entradas' ? 'Entrada' : x.categoria) + dataTxt, botoes);
}

// ---------------- Leitura de comprovante (OCR do Google Drive) ----------------
function ocr(blob) {
  var token = ScriptApp.getOAuthToken();
  var tipo = blob.getContentType();
  if (!tipo || tipo === 'application/octet-stream') tipo = 'image/jpeg';
  var b = 'bot' + Date.now();
  var meta = JSON.stringify({ name: 'comprovante-bot-temp', mimeType: 'application/vnd.google-apps.document' });
  var cab = Utilities.newBlob('--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\nContent-Type: ' + tipo + '\r\n\r\n').getBytes();
  var fim = Utilities.newBlob('\r\n--' + b + '--').getBytes();
  var r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=pt', { method: 'post', contentType: 'multipart/related; boundary=' + b, payload: cab.concat(blob.getBytes()).concat(fim), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('OCR ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  var id = JSON.parse(r.getContentText()).id;
  try {
    return UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', { headers: { Authorization: 'Bearer ' + token } }).getContentText();
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, { method: 'delete', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  }
}

function numBR(s) { return Math.round(parseFloat(String(s).replace(/\./g, '').replace(',', '.')) * 100) / 100; }

function analisarComprovante(t) {
  var txt = String(t || '').replace(/\r/g, '');
  var n = norm(txt);
  var linhas = txt.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  var valor = null;
  for (var i = 0; i < linhas.length && valor === null; i++) {
    if (/total|valor|pago|quantia/.test(norm(linhas[i]))) {
      var mm = (linhas[i] + ' ' + (linhas[i + 1] || '')).match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
      if (mm) valor = numBR(mm[1]);
    }
  }
  if (valor === null) {
    var todos = txt.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
    if (todos.length) valor = Math.max.apply(null, todos.map(numBR));
  }
  var data = null;
  var dm = txt.match(/\b(\d{2})\/(\d{2})\/(\d{2,4})\b/);
  if (dm) data = (dm[3].length === 2 ? '20' + dm[3] : dm[3]) + '-' + dm[2] + '-' + dm[1];
  else {
    var ms = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
    var d2 = n.match(/\b(\d{1,2})\s*(?:de\s*)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s*(?:de\s*)?(\d{4})?/);
    if (d2) data = (d2[3] || hojeSP(0).slice(0, 4)) + '-' + pad(ms[d2[2]]) + '-' + pad(d2[1]);
  }
  if (data && (data > hojeSP(0) || isNaN(new Date(data)))) data = null;
  var tipo = /\bpix\b|transferencia|\bdebito\b/.test(n) ? 'conta' : null;
  var loja = null;
  for (var k = 0; k < linhas.length; k++) {
    var nl = norm(linhas[k]);
    if (/^(para|destino|recebedor|favorecido|estabelecimento|loja|nome do recebedor|nome)\b/.test(nl)) {
      var resto = linhas[k].replace(/^[^:]*:\s*/, '');
      loja = resto && resto !== linhas[k] ? resto : linhas[k + 1];
      break;
    }
  }
  if (!loja) loja = linhas.filter(function (l) { return /[a-zà-ú]{3}/i.test(l) && !/comprovante|transa|pagamento|banco|data|hora|valor|r\$|cnpj|cpf|via|autoriza|aprovad|cart[aã]o|parcela|total/i.test(l); })[0] || null;
  if (loja) loja = loja.replace(/[\d*#.\-\/]{4,}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  var banco = /nubank|nu pagamentos/.test(n) ? 'nubank' : /itau/.test(n) ? 'itau' : /\binter\b/.test(n) ? 'inter' : /mercado ?pago/.test(n) ? 'mp' : /riachuelo|midway/.test(n) ? 'riachuelo' : null;
  return { valor: valor, data: data, tipo: tipo, loja: loja, banco: banco };
}

function previa(x) {
  return '🧾 <b>Li o comprovante:</b>\n' + (x.tipo === 'entrada' ? '💰 ' : x.tipo === 'conta' ? '🏦 ' : '💳 ') + '<b>' + brl(x.valor) + '</b> · ' + x.descricao +
    '\n📅 ' + x.data.slice(8) + '/' + x.data.slice(5, 7) + ' · ' + (x.cart ? x.cart.nome : '❓ escolha o cartão/conta') + '\n🏷️ ' + x.categoria + '\n\nEstá certo?';
}
function botoesPrevia(pid) {
  return [[{ text: '✅ Lançar', callback_data: 'ok:' + pid }, { text: '💳 Trocar conta', callback_data: 'tc:' + pid }, { text: '❌ Cancelar', callback_data: 'no:' + pid }]];
}
function botoesCarteiras(pid, carteiras) {
  var l = []; for (var i = 0; i < carteiras.length; i += 2) l.push(carteiras.slice(i, i + 2).map(function (c, j) { return { text: (c.tipo === 'cartao' ? '💳 ' : '🏦 ') + c.nome.slice(0, 22), callback_data: 'pc:' + pid + ':' + (i + j) }; }));
  return l;
}

function lerFoto(chat, msg) {
  var fid = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
  responder(chat, '🔎 Lendo o comprovante…');
  var f = tg('getFile', { file_id: fid }).result;
  var blob = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + PROPS.getProperty('BOT_TOKEN') + '/' + f.file_path).getBlob();
  var info = analisarComprovante(ocr(blob));
  if (!info.valor) return responder(chat, 'Não consegui achar o valor nesse comprovante 😕\nEscreva em texto, ex.: <code>45,90 farmácia nubank</code>');
  var carteiras = listar('carteiras');
  var sint = [info.tipo === 'conta' ? 'debito' : '', String(info.valor).replace('.', ','), info.loja || '', msg.caption || '', info.banco || ''].join(' ');
  var x = interpretar(sint, carteiras);
  if (x.erro) return responder(chat, x.erro);
  if (info.data) x.data = info.data;
  var pid = Utilities.getUuid().slice(0, 8);
  CacheService.getScriptCache().put('p' + pid, JSON.stringify(x), 21600);
  return responder(chat, previa(x), x.cart ? botoesPrevia(pid) : botoesCarteiras(pid, carteiras));
}

function callbackFoto(q, p) {
  var chat = q.message.chat.id, msg = q.message.message_id, pid = p[1];
  var cache = CacheService.getScriptCache();
  var raw = cache.get('p' + pid);
  if (!raw) { tg('editMessageText', { chat_id: chat, message_id: msg, text: 'Essa leitura expirou. Mande a foto de novo.' }); return tg('answerCallbackQuery', { callback_query_id: q.id }); }
  var x = JSON.parse(raw);
  if (p[0] === 'no') tg('editMessageText', { chat_id: chat, message_id: msg, text: '❌ Cancelado.' });
  else if (p[0] === 'tc') tg('editMessageReplyMarkup', { chat_id: chat, message_id: msg, reply_markup: { inline_keyboard: botoesCarteiras(pid, listar('carteiras')) } });
  else if (p[0] === 'pc') {
    var c = listar('carteiras')[Number(p[2])];
    if (c) { x.cart = c; x.tipo = c.tipo === 'cartao' ? 'compra' : (x.tipo === 'compra' ? 'conta' : x.tipo); cache.put('p' + pid, JSON.stringify(x), 21600); }
    tg('editMessageText', { chat_id: chat, message_id: msg, parse_mode: 'HTML', text: previa(x), reply_markup: { inline_keyboard: botoesPrevia(pid) } });
  } else if (p[0] === 'ok') {
    if (!x.cart && x.tipo !== 'entrada') { tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Escolha o cartão ou a conta primeiro' }); return; }
    cache.remove('p' + pid);
    tg('editMessageReplyMarkup', { chat_id: chat, message_id: msg, reply_markup: { inline_keyboard: [] } });
    gravar(chat, x);
  }
  return tg('answerCallbackQuery', { callback_query_id: q.id });
}

// Rode no editor depois de autorizar: testa a permissão do Google Drive (OCR).
function testarOCR() { Logger.log('OCR ok: ' + JSON.stringify(analisarComprovante('Comprovante Pix\nPara: Padaria Pão Quente\nValor: R$ 12,50\nData 22/11/2026'))); var t = ocr(Utilities.newBlob('teste', 'text/plain')); Logger.log('Drive ok'); }

// ===== Calculos copiados do app (calc.js + planos.js v2.6) =====
var CALC = (function () {
// Regras de negócio e cálculos (sem interface).

const CATS = {
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
function configurar(p = {}) {
  INICIO = Math.min(28, Math.max(1, Number(p.diaInicio) || 1));
  EXTRAS = {};
  (p.categorias || []).forEach((c) => { if (c && c.nome) EXTRAS[c.nome] = { e: c.e || '🏷️', c: c.c || '#a1a1aa', custom: true }; });
}
const diaInicio = () => INICIO;
const catInfo = (k) => EXTRAS[k] || CATS[k] || CATS.Outros;
const listaCategorias = () => [...Object.keys(CATS).filter((k) => k !== 'Cartão de crédito' && k !== 'Outros'), ...Object.keys(EXTRAS), 'Outros'];
const CORES = ['#ff6b35', '#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#64748b'];

const pad = (n) => String(n).padStart(2, '0');
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoDe = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Mês financeiro de uma data: com início no dia 5, 03/12 pertence a novembro.
function mesDe(iso) {
  if (!iso) return '';
  const m = iso.slice(0, 7);
  return Number(iso.slice(8, 10)) >= INICIO ? m : somarMes(m, -1);
}
const noMes = (iso, ym) => mesDe(iso) === ym;
const ymAtual = () => mesDe(hojeISO());
function periodo(ym) {
  const ini = diaNoMes(ym, INICIO);
  if (INICIO === 1) return [ini, diaNoMes(ym, 31)];
  const [a, m, d] = diaNoMes(somarMes(ym, 1), INICIO).split('-').map(Number);
  return [ini, isoDe(new Date(a, m - 1, d - 1))];
}
function diasDoPeriodo(ym) {
  const [ini, fim] = periodo(ym);
  const out = [];
  const [a, m, d] = ini.split('-').map(Number);
  for (let x = new Date(a, m - 1, d); isoDe(x) <= fim; x.setDate(x.getDate() + 1)) out.push(isoDe(x));
  return out;
}
// Data, dentro do mês financeiro `ym`, de algo que acontece todo dia `dia`.
const dataNoPeriodo = (ym, dia) => (Number(dia) >= INICIO ? diaNoMes(ym, dia) : diaNoMes(somarMes(ym, 1), dia));
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const soma = (arr) => r2(arr.reduce((s, x) => s + (Number(x.valor) || 0), 0));
const vis = (l) => l.filter((x) => !x.excluida);
const dataBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const slug = (s) => String(s).normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase();

function somarMes(ym, n) {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function diaNoMes(ym, dia) {
  const [a, m] = ym.split('-').map(Number);
  return `${ym}-${pad(Math.min(Number(dia) || 1, new Date(a, m, 0).getDate()))}`;
}
function nomeMes(ym, curto = false) {
  const [a, m] = ym.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: curto ? 'short' : 'long' }).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function rotuloMes(ym) {
  return `${nomeMes(ym)} ${ym.slice(0, 4)}`;
}
function diasAte(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const [ha, hm, hd] = hojeISO().split('-').map(Number);
  return Math.round((new Date(a, m - 1, d) - new Date(ha, hm - 1, hd)) / 86400000);
}
function parseValor(txt) {
  let s = String(txt ?? '').trim().replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = r2(parseFloat(s));
  return isFinite(v) && s !== '' ? v : NaN;
}

// ---------------- Cartão de crédito ----------------
const cartoes = (D) => D.carteiras.filter((c) => c.tipo === 'cartao');
const contasBancarias = (D) => D.carteiras.filter((c) => c.tipo !== 'cartao');

// Mês (de vencimento) da fatura em que cai uma compra feita em `data`.
function mesFatura(card, data) {
  const fech = Number(card.fechamento) || 1;
  const venc = Number(card.vencimento) || 10;
  let m = data.slice(0, 7);
  if (Number(data.slice(8, 10)) >= fech) m = somarMes(m, 1);
  if (venc <= fech) m = somarMes(m, 1);
  return m;
}

function parcelasDe(compra, card) {
  const n = Math.max(1, Number(compra.parcelas) || 1);
  const totalC = Math.round(Number(compra.valor) * 100);
  const base = Math.floor(totalC / n);
  const resto = totalC - base * n;
  const m0 = mesFatura(card, compra.data);
  return Array.from({ length: n }, (_, i) => ({ ym: somarMes(m0, i), i: i + 1, n, valor: (base + (i === 0 ? resto : 0)) / 100 }));
}

// Primeiro mês com fatura neste cartão (para saber até onde olhar saldos em atraso).
function primeiroMesCartao(D, card) {
  let m = null;
  vis(D.compras).filter((x) => x.carteiraId === card.id).forEach((cp) => { const f = mesFatura(card, cp.data); if (!m || f < m) m = f; });
  return m;
}
// Taxa mensal estimada sobre saldo em atraso: juros do rotativo do cartão + multa (2%) + mora (1%) + IOF (~0,4%).
const taxaAtraso = (card) => (Number(card.jurosAtraso) > 0 ? Number(card.jurosAtraso) + 3.4 : 0);

// Fatura do mês. Se a fatura anterior venceu sem pagamento, o saldo dela entra nesta, como faz o banco,
// mais os juros estimados (quando o cartão tem a taxa cadastrada).
function faturaDe(D, card, ym, prof = 0) {
  const itens = [];
  vis(D.compras).filter((x) => x.carteiraId === card.id).forEach((cp) => {
    parcelasDe(cp, card).filter((p) => p.ym === ym).forEach((p) => itens.push({ ...p, compra: cp }));
  });
  itens.sort((a, b) => b.compra.data.localeCompare(a.compra.data));
  const id = `${card.id}_${ym}`;
  const doc = D.faturas.find((f) => f.id === id) || {};
  let saldoAnterior = 0; let jurosEst = 0; let anteriores = []; let mesAnterior = null;
  const ini = primeiroMesCartao(D, card);
  if (ini && somarMes(ym, -1) >= ini && prof < 36) {
    const prev = faturaDe(D, card, somarMes(ym, -1), prof + 1);
    if (!prev.pago && prev.valor > 0 && diasAte(prev.data) < 0) {
      saldoAnterior = prev.valor;
      jurosEst = r2(saldoAnterior * taxaAtraso(card) / 100);
      anteriores = [prev.id, ...prev.anteriores];
      mesAnterior = prev.ym;
    }
  }
  const valorItens = soma(itens);
  const valor = r2(valorItens + saldoAnterior + jurosEst);
  const data = diaNoMes(ym, card.vencimento);
  const pago = !!doc.pago;
  return {
    tipo: 'fatura', id, card, ym, itens, valorItens, saldoAnterior, jurosEst, anteriores, mesAnterior, valor,
    data, fecha: diaNoMes(somarMes(ym, Number(card.vencimento) <= Number(card.fechamento) ? -1 : 0), card.fechamento),
    pago, pagoEm: doc.pagoEm || null, carteiraId: doc.carteiraId || null, valorPago: doc.valor || 0, quitadaPor: doc.quitadaPor || null,
    rolada: !pago && valor > 0 && diasAte(data) < 0,
    descricao: `Fatura ${card.nome}`, categoria: 'Cartão de crédito',
  };
}
const faturasMes = (D, ym) => cartoes(D).map((c) => faturaDe(D, c, ym));

function limiteUsado(D, card) {
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
function saldoCarteira(D, cart) {
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
const saldoTotal = (D) => r2(contasBancarias(D).reduce((t, c) => t + saldoCarteira(D, c), 0));

// ---------------- Resumo do mês ----------------
function pagaveisMes(D, ym) {
  const contas = vis(D.contas).filter((c) => noMes(c.data, ym)).map((c) => ({ ...c, tipo: 'conta' }));
  // A fatura entra no mês financeiro do seu vencimento.
  const fats = [-1, 0, 1].flatMap((k) => faturasMes(D, somarMes(ym, k)))
    .filter((f) => noMes(f.data, ym) && (f.valor > 0 || f.pago));
  return [...contas, ...fats];
}

function resumoMes(D, ym) {
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

function gastosPorCategoria(D, ym) {
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
function gastosPorDia(D, ym) {
  const m = {};
  const add = (iso, v) => { if (iso && noMes(iso, ym)) m[iso] = r2((m[iso] || 0) + Number(v || 0)); };
  vis(D.contas).filter((c) => c.pago).forEach((c) => add(c.pagoEm, c.valor));
  vis(D.compras).forEach((cp) => add(cp.data, cp.valor));
  return m;
}

function serieMeses(D, ym, n = 6) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const m = somarMes(ym, -k);
    const r = resumoMes(D, m);
    out.push({ ym: m, entrou: r.entrou, saiu: r.total });
  }
  return out;
}

function orcamentosMes(D, ym) {
  const g = Object.fromEntries(gastosPorCategoria(D, ym));
  return D.orcamentos
    .map((o) => ({ ...o, gasto: g[o.categoria] || 0, pct: o.limite > 0 ? Math.round(((g[o.categoria] || 0) / o.limite) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);
}

// ---------------- Comissões ----------------
// Uma venda gera a comissão em 1 ou mais parcelas: cada parcela é recebida no mês em que o cliente paga.
function dividir(total, n) {
  const c = Math.round(Number(total) * 100);
  const base = Math.floor(c / n);
  const resto = c - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i === 0 ? resto : 0)) / 100);
}

function parcelasComissao(D, { incluirCanceladas = false } = {}) {
  const out = [];
  (D.comissoes || []).forEach((com) => {
    if (com.cancelada && !incluirCanceladas) return;
    const ps = com.parcelas || [];
    ps.forEach((p, i) => out.push({ com, i, n: ps.length, ...p }));
  });
  return out;
}

function resumoComissoes(D, ym) {
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

function serieComissoes(D, ym, n = 6) {
  const ps = parcelasComissao(D).filter((p) => p.recebido);
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const m = somarMes(ym, -k);
    out.push({ ym: m, valor: soma(ps.filter((p) => noMes(p.recebidoEm, m))) });
  }
  return out;
}

function rankingComissoes(D, campo) {
  const m = {};
  (D.comissoes || []).filter((c) => !c.cancelada).forEach((c) => {
    const k = (c[campo] || '—').trim() || '—';
    const v = (c.parcelas || []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
    m[k] = r2((m[k] || 0) + v);
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

// ---------------- Saúde financeira ----------------
const RX_ENCARGO = /juro|encargo|multa|iof|rotativo|renegocia|refinanc|pendente|financiad|ajuste/i;

// Tudo que já venceu e não foi pago, olhando até 12 meses para trás.
const addDias = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); const x = new Date(a, m - 1, d + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const difDias = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
function eventosFuturos(D, dias = 60, { comissoes = false } = {}) {
  const hoje = hojeISO(); const fim = addDias(hoje, dias); const ev = [];
  vis(D.contas).filter((c) => !c.pago).forEach((c) => { const d = c.data < hoje ? hoje : c.data; if (d <= fim) ev.push({ d, v: -c.valor, t: c.descricao, k: c.data < hoje ? 'vencida' : 'conta' }); });
  vis(D.entradas).filter((e) => e.data > hoje && e.data <= fim).forEach((e) => ev.push({ d: e.data, v: +e.valor, t: e.descricao, k: 'entrada' }));
  // Recorrências de meses ainda não gerados
  for (let k = 0; k <= Math.ceil(dias / 28) + 1; k++) {
    const m = somarMes(ymAtual(), k);
    D.recorrentes.forEach((r) => {
      if (r.tipo === 'compra' || !r.inicio || r.inicio > m || (r.fim && m > r.fim)) return;
      const col = r.tipo === 'entrada' ? D.entradas : D.contas;
      if (col.some((x) => x.id === `${r.id}_${m}`)) return;
      const d = dataNoPeriodo(m, r.dia);
      if (d > hoje && d <= fim) ev.push({ d, v: r.tipo === 'entrada' ? +r.valor : -r.valor, t: r.descricao, k: r.tipo === 'entrada' ? 'entrada' : 'conta' });
    });
  }
  // Faturas a vencer (as atrasadas já estão somadas na seguinte)
  cartoes(D).forEach((card) => {
    for (let k = 0; k <= 3; k++) {
      const f = faturaDe(D, card, somarMes(ymAtual(), k));
      // Assinaturas futuras ainda não lançadas entram na estimativa da fatura
      const extra = D.recorrentes.filter((r) => r.tipo === 'compra' && r.carteiraId === card.id && (!r.fim || r.fim >= f.ym))
        .filter((r) => { const md = somarMes(f.ym, -1); return r.inicio <= md && !D.compras.some((x) => x.id === `${r.id}_${md}`) && mesFatura(card, dataNoPeriodo(md, r.dia)) === f.ym; })
        .reduce((t, r) => t + Number(r.valor || 0), 0);
      const v = r2(f.valor + extra);
      if (!f.pago && v > 0 && f.data >= hoje && f.data <= fim) ev.push({ d: f.data, v: -v, t: f.descricao, k: 'fatura' });
    }
  });
  if (comissoes) parcelasComissao(D).filter((p) => !p.recebido && p.data >= hoje && p.data <= fim).forEach((p) => ev.push({ d: p.data, v: +p.valor, t: `Comissão · ${p.com.empresa}`, k: 'entrada' }));
  return ev.sort((a, b) => a.d.localeCompare(b.d) || b.v - a.v);
}

function projecao(D, dias = 60, opts = {}) {
  const hoje = hojeISO();
  const saldo0 = saldoTotal(D);
  const ev = eventosFuturos(D, dias, opts);
  const serie = []; let s = saldo0; let i = 0;
  for (let n = 0; n <= dias; n++) {
    const d = addDias(hoje, n);
    while (i < ev.length && ev[i].d === d) { s += ev[i].v; ev[i].saldo = r2(s); i++; }
    serie.push({ d, s: r2(s) });
  }
  const min = serie.reduce((m, x) => (x.s < m.s ? x : m), serie[0]);
  const prox = ev.find((e) => e.v > 0);
  const limite = prox ? prox.d : addDias(hoje, 30);
  const janela = Math.max(1, difDias(hoje, limite));
  const ateLimite = saldo0 + ev.filter((e) => e.d < limite).reduce((t, e) => t + e.v, 0);
  return { saldo0, ev, serie, min, prox, janela, podeGastar: Math.max(0, r2(ateLimite / janela)), saldoAntesDaEntrada: r2(ateLimite) };
}
return {configurar: configurar, ymAtual: ymAtual, contasBancarias: contasBancarias, cartoes: cartoes, saldoCarteira: saldoCarteira, saldoTotal: saldoTotal, faturaDe: faturaDe, somarMes: somarMes, diasAte: diasAte, dataBR: dataBR, resumoMes: resumoMes, orcamentosMes: orcamentosMes, projecao: projecao, mesDe: mesDe};
})();

// ================= Consultas e avisos (v2) =================
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
try { AJUDA += '\n\n<b>Consultas</b>\n/saldo · saldo das contas\n/fatura · faturas abertas (/fatura nubank detalha)\n/hoje · quanto posso gastar hoje\n/avisos · vencimentos e alertas\n/semana · resumo da semana\n/sair · desconectar este Telegram'; } catch (e) {}
var COLS_D = ['contas', 'entradas', 'recorrentes', 'carteiras', 'compras', 'faturas', 'transferencias', 'orcamentos', 'config', 'comissoes'];

function carregarD() {
  var D = {};
  COLS_D.forEach(function (c) { try { D[c] = listar(c) || []; } catch (e) { D[c] = []; } });
  var prefs = D.config.filter(function (x) { return x.id === 'prefs'; })[0] || {};
  CALC.configurar(prefs);
  D._prefs = prefs;
  return D;
}

function cmdSaldo() {
  var D = carregarD();
  var linhas = CALC.contasBancarias(D).map(function (c) { return '• ' + esc(c.nome) + ': ' + brl(CALC.saldoCarteira(D, c)); });
  var p = CALC.projecao(D, 60, { comissoes: !!D._prefs.modComissoes });
  return '🏦 <b>Saldo das contas</b>\n' + linhas.join('\n') + '\n\n<b>Total: ' + brl(CALC.saldoTotal(D)) + '</b>' +
    '\n📉 Menor saldo previsto (60 dias): ' + brl(p.min.s) + ' em ' + CALC.dataBR(p.min.d);
}

function cmdFatura(arg) {
  var D = carregarD();
  var ym = CALC.ymAtual();
  var cards = CALC.cartoes(D);
  var q = norm(arg || '');
  if (q) cards = cards.filter(function (c) { return norm(c.nome).indexOf(q) >= 0; });
  if (!cards.length) return 'Não achei esse cartão. Cartões: ' + CALC.cartoes(D).map(function (c) { return c.nome; }).join(', ');
  var out = cards.map(function (card) {
    // fatura aberta = a próxima que ainda não venceu
    var f = null;
    for (var k = -1; k <= 2; k++) {
      var x = CALC.faturaDe(D, card, CALC.somarMes(ym, k));
      if (!x.pago && x.valor > 0 && CALC.diasAte(x.data) >= 0) { f = x; break; }
    }
    if (!f) return '💳 <b>' + esc(card.nome) + '</b>: nada em aberto ✅';
    var s = '💳 <b>' + esc(card.nome) + '</b>: ' + brl(f.valor) + ' · vence ' + CALC.dataBR(f.data) + ' · fecha ' + CALC.dataBR(f.fecha);
    if (f.saldoAnterior > 0) s += '\n   ⚠️ inclui ' + brl(f.saldoAnterior) + ' em atraso + ' + brl(f.jurosEst) + ' de juros estimados';
    if (q) {
      s += '\n' + f.itens.slice(0, 15).map(function (i) {
        return '   ' + CALC.dataBR(i.compra.data) + ' ' + esc(i.compra.descricao) + (i.n > 1 ? ' (' + i.i + '/' + i.n + ')' : '') + ' · ' + brl(i.valor);
      }).join('\n');
      if (f.itens.length > 15) s += '\n   … +' + (f.itens.length - 15) + ' itens';
    }
    return s;
  });
  return out.join('\n\n') + (q ? '' : '\n\nDetalhe: /fatura nubank');
}

function cmdHoje() {
  var D = carregarD();
  var p = CALC.projecao(D, 60, { comissoes: !!D._prefs.modComissoes });
  var r = CALC.resumoMes(D, CALC.ymAtual());
  var s = '💸 <b>Pode gastar hoje: ' + brl(p.podeGastar) + '/dia</b>' +
    (p.prox ? '\naté a próxima entrada (' + CALC.dataBR(p.prox.d) + ': ' + esc(p.prox.t) + ')' : '\nnos próximos 30 dias') +
    '\n\n📅 Mês: entrou ' + brl(r.entrou) + ' · pago ' + brl(r.pago) + ' · falta pagar ' + brl(r.aPagar);
  var prox = p.ev.filter(function (e) { return e.v < 0; }).slice(0, 5);
  if (prox.length) s += '\n\n<b>Próximas saídas</b>\n' + prox.map(function (e) { return '• ' + CALC.dataBR(e.d) + ' ' + esc(e.t) + ' · ' + brl(-e.v); }).join('\n');
  return s;
}

// Texto do aviso diário (vazio = nada para avisar)
function nomeCurto(s) { return String(s || '').replace(/^Fatura\s+/i, '').replace(/\s*[•·]+\s*\d{3,4}\b/g, '').replace(/\s+·\s+.*$/, '').trim(); }
function textoAvisos(auto) {
  var D = carregarD();
  var ym = CALC.ymAtual();
  var atras = [], venc = [], fech = [], orc = [], vistos = {};
  var abertos = CALC.resumoMes(D, ym).abertos.concat(CALC.resumoMes(D, CALC.somarMes(ym, 1)).abertos);
  abertos.forEach(function (x) {
    if (vistos[x.id]) return; vistos[x.id] = 1;
    var d = CALC.diasAte(x.data);
    var nome = esc(nomeCurto(x.descricao));
    if (d < 0) atras.push({ v: Number(x.valor) || 0, rol: !!x.rolada, t: '• ' + nome + ' · ' + brl(x.valor) + ' · ' + (-d) + (d === -1 ? ' dia' : ' dias') });
    else if (d <= 3) venc.push('• ' + nome + ' · ' + brl(x.valor) + ' · ' + (d === 0 ? 'hoje' : d === 1 ? 'amanhã' : 'em ' + d + ' dias'));
  });
  CALC.cartoes(D).forEach(function (card) {
    for (var k = 0; k <= 2; k++) {
      var f = CALC.faturaDe(D, card, CALC.somarMes(ym, k));
      var d = CALC.diasAte(f.fecha);
      if (!f.pago && d >= 0 && d <= 2 && f.valor > 0) { fech.push('• ' + esc(nomeCurto(card.nome)) + ' · ' + (d === 0 ? 'hoje' : d === 1 ? 'amanhã' : 'em ' + d + ' dias') + ' · ' + brl(f.valor)); break; }
    }
  });
  var P = PropertiesService.getScriptProperties();
  CALC.orcamentosMes(D, ym).forEach(function (o) {
    var faixa = o.pct >= 100 ? 100 : (o.pct >= 80 ? 80 : 0);
    if (!faixa) return;
    var key = 'ORC_' + UID.slice(0, 8) + '_' + ym + '_' + o.categoria;
    if (auto) { if (Number(P.getProperty(key) || 0) >= faixa) return; P.setProperty(key, String(faixa)); }
    orc.push('• ' + esc(o.categoria) + ' · ' + brl(o.gasto) + ' de ' + brl(o.limite) + (faixa === 100 ? ' 🚨' : ' (' + o.pct + '%)'));
  });
  var p = CALC.projecao(D, 30, { comissoes: !!D._prefs.modComissoes });
  if (!atras.length && !venc.length && !fech.length && !orc.length && p.min.s >= 0) return '';
  var DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var dt = new Date();
  var t = '☀️ <b>' + (auto ? 'Bom dia! Seus avisos' : 'Avisos') + '</b> · ' + DIAS[dt.getDay()] + ', ' + pad(dt.getDate()) + '/' + pad(dt.getMonth() + 1);
  if (atras.length) {
    var tot = Math.round(atras.reduce(function (a, x) { return a + x.v; }, 0) * 100) / 100;
    t += '\n\n🔴 <b>Em atraso · ' + brl(tot) + '</b>\n' + atras.map(function (x) { return x.t; }).join('\n');
    if (atras.some(function (x) { return x.rol; })) t += '\n<i>↳ faturas já somadas à próxima, com juros</i>';
  }
  if (venc.length) t += '\n\n⏰ <b>Vencendo</b>\n' + venc.join('\n');
  if (fech.length) t += '\n\n💳 <b>Fechando</b>\n' + fech.join('\n');
  if (orc.length) t += '\n\n📊 <b>Orçamento</b>\n' + orc.join('\n');
  t += '\n\n' + (p.min.s < 0 ? '📉 Saldo previsto: ' + brl(p.min.s) + ' em ' + CALC.dataBR(p.min.d) + '\n' : '') + '💸 Pode gastar hoje: <b>' + brl(p.podeGastar) + '</b>';
  return t;
}

// Rodado pelo gatilho diário (8h)
function avisoDiario() {
  var alvos = [];
  var dono = PROPS.getProperty('ALLOWED_CHAT');
  if (dono) alvos.push([dono, UID_DONO]);
  var m = chatsVinculados();
  Object.keys(m).forEach(function (c) { alvos.push([c, m[c].uid]); });
  alvos.forEach(function (a) {
    try { UID = a[1]; var t = textoAvisos(true); if (t) responder(a[0], t); if (new Date().getDay() === 0) responder(a[0], resumoSemanal()); }
    catch (e) { console.log('aviso falhou p/ chat ' + a[0] + ': ' + e.message); }
  });
  UID = UID_DONO;
}

function ativarAvisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'avisoDiario') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('avisoDiario').timeBased().everyDays(1).atHour(8).create();
  Logger.log('Aviso diário ativado (8h)');
}

function testarConsultas() {
  Logger.log(cmdSaldo());
  Logger.log(cmdFatura(''));
  Logger.log(cmdHoje());
  Logger.log('AVISOS: ' + (textoAvisos() || '(nada)'));
}

// Comandos novos: devolve true se tratou
function comandoConsulta(chat, texto) {
  var m = String(texto || '').trim().match(/^\/(saldo|fatura|faturas|hoje|avisos|semana)(@\w+)?\s*(.*)$/i);
  if (!m) return false;
  var c = m[1].toLowerCase();
  try {
    if (c === 'saldo') responder(chat, cmdSaldo());
    else if (c === 'fatura' || c === 'faturas') responder(chat, cmdFatura(m[3]));
    else if (c === 'hoje') responder(chat, cmdHoje());
    else if (c === 'semana') responder(chat, resumoSemanal());
    else if (c === 'avisos') responder(chat, textoAvisos() || '✅ Nada para avisar hoje.');
  } catch (e) { responder(chat, '⚠️ Erro na consulta: ' + e.message); }
  return true;
}


// Nome, bio, descrição e menu de comandos do bot (rode uma vez)
function configurarPerfilBot() {
  var r = [];
  r.push(tg('setMyName', { name: 'Minhas Finanças' }));
  r.push(tg('setMyShortDescription', { short_description: 'Seu assistente financeiro: lance gastos, mande comprovantes e consulte saldo e faturas. 💸' }));
  r.push(tg('setMyDescription', { description: '💸 Lance gastos escrevendo, como "50 mercado nubank"\n📷 Mande a foto do comprovante e eu leio o valor\n💳 /fatura, /saldo e /hoje para consultar\n☀️ Avisos diários de vencimentos e orçamento\n\nPara começar: app Minhas Finanças → Perfil → Conectar Telegram.' }));
  r.push(tg('setMyCommands', { commands: [
    { command: 'saldo', description: 'Saldo das contas' },
    { command: 'fatura', description: 'Faturas abertas (ex.: /fatura nubank)' },
    { command: 'hoje', description: 'Quanto posso gastar hoje' },
    { command: 'avisos', description: 'Vencimentos e alertas' },
    { command: 'semana', description: 'Resumo dos últimos 7 dias' },
    { command: 'contas', description: 'Minhas contas e cartões' },
    { command: 'ajuda', description: 'Como lançar gastos' },
    { command: 'sair', description: 'Desconectar este Telegram' }
  ] }));
  r.forEach(function (x, i) { Logger.log(i + ': ' + JSON.stringify(x)); });
}


// ---------------- Resumo semanal (domingo à noite e /semana) ----------------
function gastosPeriodo(D, ini, fim) {
  var tot = 0, cats = {}, n = 0;
  var add = function (cat, v) { v = Number(v) || 0; tot += v; n++; cat = cat || 'Outros'; cats[cat] = (cats[cat] || 0) + v; };
  D.contas.forEach(function (c) { if (!c.excluida && c.pago && c.pagoEm && c.pagoEm >= ini && c.pagoEm <= fim) add(c.categoria, c.valor); });
  D.compras.forEach(function (c) { if (!c.excluida && c.data && c.data >= ini && c.data <= fim) add(c.categoria, c.valor); });
  return { tot: Math.round(tot * 100) / 100, n: n, cats: Object.keys(cats).map(function (k) { return [k, cats[k]]; }).filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; }) };
}
function resumoSemanal() {
  var D = carregarD();
  var ini = hojeSP(-6), fim = hojeSP(0);
  var g = gastosPeriodo(D, ini, fim), ant = gastosPeriodo(D, hojeSP(-13), hojeSP(-7));
  var t = '📆 <b>Sua semana</b> · ' + CALC.dataBR(ini) + ' a ' + CALC.dataBR(fim) + '\n\n💸 Gastou <b>' + brl(g.tot) + '</b> em ' + g.n + (g.n === 1 ? ' lançamento' : ' lançamentos');
  if (ant.tot > 0) {
    var dif = Math.round((g.tot - ant.tot) / ant.tot * 100);
    t += '\n' + (dif > 0 ? '📈 ' + dif + '% a mais' : dif < 0 ? '📉 ' + (-dif) + '% a menos' : '➖ igual') + ' que a semana anterior (' + brl(ant.tot) + ')';
  }
  if (g.cats.length) t += '\n\n🏷️ <b>Onde foi</b>\n' + g.cats.slice(0, 4).map(function (c) { return '• ' + esc(c[0]) + ' · ' + brl(c[1]) + (g.tot > 0 ? ' (' + Math.round(c[1] / g.tot * 100) + '%)' : ''); }).join('\n');
  var p = CALC.projecao(D, 30, { comissoes: !!D._prefs.modComissoes });
  var lim = hojeSP(7);
  var prox = p.ev.filter(function (e) { return e.v < 0 && e.d <= lim; });
  if (prox.length) {
    var totP = Math.round(prox.reduce(function (a, e) { return a - e.v; }, 0) * 100) / 100;
    t += '\n\n⏰ <b>Próximos 7 dias · ' + brl(totP) + '</b>\n' + prox.slice(0, 6).map(function (e) { return '• ' + CALC.dataBR(e.d) + ' ' + esc(nomeCurto(e.t)) + ' · ' + brl(-e.v); }).join('\n') + (prox.length > 6 ? '\n• … +' + (prox.length - 6) : '');
  }
  t += '\n\n💸 Pode gastar hoje: <b>' + brl(p.podeGastar) + '</b>';
  return t;
}
function resumoSemanalTodos() {
  var alvos = [];
  var dono = PROPS.getProperty('ALLOWED_CHAT');
  if (dono) alvos.push([dono, UID_DONO]);
  var mm = chatsVinculados();
  Object.keys(mm).forEach(function (c) { alvos.push([c, mm[c].uid]); });
  alvos.forEach(function (a) {
    try { UID = a[1]; responder(a[0], resumoSemanal()); }
    catch (e) { console.log('resumo falhou p/ chat ' + a[0] + ': ' + e.message); }
  });
  UID = UID_DONO;
}
function testarSemana() { Logger.log(resumoSemanal()); Logger.log(textoAvisos()); }
