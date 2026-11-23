// Bot do Telegram · Minhas Finanças (@violinhabot) — Google Apps Script
// Acessa o Firestore com a sua própria conta Google (sem chave secreta).
// Configuração: abra a URL do app da Web, cole o token do @BotFather e toque no link de /start.

var PROJETO = 'minhas-financas-1ed86';
var UID = 'eKcRXnGu6FbpMVUTkHOqMptwDPX2';
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

var COLS = { p: 'compras', c: 'contas', e: 'entradas' };
function callback(q) {
  var p = q.data.split(':'); var acao = p[0], col = COLS[p[1]], id = p[2];
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
    return pagina('<h2>Quase lá ✅</h2><p>Toque no link abaixo e depois em <b>Iniciar</b> no Telegram para liberar o bot só para você:</p><p><a style="font-size:18px" href="https://t.me/' + BOT_USER + '?start=' + codigoPareamento() + '">Abrir @' + BOT_USER + '</a></p>');
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
    return pagina('<h2>Conectado ✅</h2><p>Agora toque no link e depois em <b>Iniciar</b> no Telegram:</p><p><a style="font-size:18px" href="https://t.me/' + BOT_USER + '?start=' + codigoPareamento() + '">Abrir @' + BOT_USER + '</a></p>');
  }
  if (!e.parameter || e.parameter.k !== PROPS.getProperty('SEGREDO')) return ok;
  var up = JSON.parse(e.postData.contents);
  var cache = CacheService.getScriptCache();
  if (cache.get('u' + up.update_id)) return ok; // o Telegram reenvia; processa uma vez só
  cache.put('u' + up.update_id, '1', 21600);
  var chat = up.message ? up.message.chat.id : (up.callback_query ? up.callback_query.message.chat.id : null);
  var texto = up.message && up.message.text ? up.message.text.trim() : '';
  try {
    var permitido = PROPS.getProperty('ALLOWED_CHAT');
    if (/^\/start/.test(texto)) {
      var cod = texto.split(' ')[1];
      if (!permitido && cod && cod === PROPS.getProperty('PAREAMENTO')) { PROPS.setProperty('ALLOWED_CHAT', String(chat)); permitido = String(chat); }
      responder(chat, String(chat) === permitido ? '👋 Bot liberado para você!\n\n' + AJUDA : 'Este bot é particular.');
      return ok;
    }
    if (String(chat) !== permitido) return ok;
    if (up.callback_query) callback(up.callback_query);
    else if (texto === '/ajuda' || texto === '/help') responder(chat, AJUDA);
    else if (texto === '/contas') responder(chat, listar('carteiras').map(function (c) { return (c.tipo === 'cartao' ? '💳 ' : '🏦 ') + c.nome; }).join('\n') || 'Nenhuma cadastrada.');
    else if (texto) lancar(chat, texto);
  } catch (err) {
    if (chat) responder(chat, '⚠️ Erro: ' + String(err.message || err).slice(0, 300));
  }
  return ok;
}

// Rode uma vez no editor para autorizar o acesso ao Firestore e testar a leitura.
function testarAcesso() { Logger.log(listar('carteiras').map(function (c) { return c.nome; }).join(', ')); }
