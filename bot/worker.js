// Bot do Telegram do app Minhas Finanças — roda no Cloudflare Workers (plano grátis).
// Variáveis (Settings > Variables and Secrets do Worker):
//   BOT_TOKEN       (secret) token do @BotFather
//   FIREBASE_SA     (secret) conteúdo do JSON da conta de serviço do Firebase
//   USER_UID        (texto)  seu UID no Firebase (Authentication > Usuários)
//   WEBHOOK_SECRET  (secret) qualquer senha inventada por você (letras e números)
//   ALLOWED_CHAT    (texto)  seu chat id (o bot mostra no /start). Sem isso, o bot só responde o /start.

const CATS = ['Alimentação', 'Restaurantes', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Compras', 'Assinaturas', 'Água/Luz/Internet', 'Moradia', 'Impostos', 'Outros'];
const REGRAS = [
  [/uber|99|cabify|posto|gasolina|combust|estacion|pedagio|onibus|metro|bilhete/, 'Transporte'],
  [/ifood|restaurante|lanche|lanchonete|burger|mc ?donald|pizza|salgado|coxinha|pastel|cafe|acai|sorvete|bar\b|cerveja|almoco|janta|marmita|sushi/, 'Restaurantes'],
  [/mercado|supermerc|padaria|feira|hortifruti|acougue|atacad|assai|carrefour|pao\b/, 'Alimentação'],
  [/netflix|spotify|youtube|disney|hbo|prime|deezer|apple|google one|icloud|claude|chatgpt|duolingo|meli|globoplay/, 'Assinaturas'],
  [/farmacia|remedio|drogaria|medico|consulta|exame|dentista|hospital|academia|petlove/, 'Saúde'],
  [/aluguel|condominio|iptu|luz|agua|gas\b/, 'Moradia'],
  [/vivo|claro|tim\b|internet|celular|telefone/, 'Água/Luz/Internet'],
  [/curso|livro|escola|faculdade|udemy|alura/, 'Educação'],
  [/cinema|show|ingresso|jogo|steam|viagem|hotel|airbnb|passeio/, 'Lazer'],
  [/roupa|tenis|camisa|shopee|amazon|mercado ?livre|shein|loja|presente|riachuelo|renner/, 'Compras'],
];
const PARADAS = new Set(['no', 'na', 'do', 'da', 'de', 'em', 'com', 'cartao', 'credito', 'debito', 'pix', 'paguei', 'gastei', 'comprei', 'recebi', 'entrada', 'ganhei', 'reais', 'r', 'hoje', 'ontem', 'conta', 'pelo', 'pela', 'um', 'uma', 'o', 'a']);
const GENERICAS = new Set(['linha', 'credito', 'gold', 'platinum', 'conta', 'cartao', 'de', 'do', 'da']);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = (n) => String(n).padStart(2, '0');
const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function hojeSP(deltaDias = 0) {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + deltaDias * 86400000); // America/Sao_Paulo (UTC-3)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function mesFatura(card, data) {
  const fech = Number(card.fechamento) || 1; const venc = Number(card.vencimento) || 10;
  let [y, m] = data.split('-').map(Number); const d = Number(data.slice(8, 10));
  if (d >= fech) m++;
  if (venc <= fech) m++;
  while (m > 12) { m -= 12; y++; }
  return `${MESES[m - 1]}/${String(y).slice(2)}`;
}

// ---------------- Google / Firestore ----------------
let tokenCache = null;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));
async function googleToken(env) {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const sa = JSON.parse(env.FIREBASE_SA);
  const agora = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64urlStr(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${body}.${b64url(sig)}` });
  const j = await r.json();
  if (!j.access_token) throw new Error('Falha no login do Firebase: ' + JSON.stringify(j).slice(0, 200));
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}
const base = (env) => `https://firestore.googleapis.com/v1/projects/${JSON.parse(env.FIREBASE_SA).project_id}/databases/(default)/documents/usuarios/${env.USER_UID}`;
function paraFS(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) f[k] = { nullValue: null };
    else if (typeof v === 'boolean') f[k] = { booleanValue: v };
    else if (typeof v === 'number') f[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else f[k] = { stringValue: String(v) };
  }
  return { fields: f };
}
function deFS(doc) {
  const o = { id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) o[k] = v.stringValue ?? (v.doubleValue !== undefined ? Number(v.doubleValue) : v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue ?? null);
  return o;
}
async function fs(env, metodo, caminho, corpo) {
  const r = await fetch(`${base(env)}/${caminho}`, { method: metodo, headers: { authorization: `Bearer ${await googleToken(env)}`, 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  if (!r.ok) throw new Error(`Firestore ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return metodo === 'DELETE' ? null : r.json();
}
const listar = async (env, col) => ((await fs(env, 'GET', `${col}?pageSize=300`)).documents || []).map(deFS);

// ---------------- Telegram ----------------
async function tg(env, metodo, dados) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${metodo}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) });
  return r.json();
}
const responder = (env, chat, texto, botoes) => tg(env, 'sendMessage', { chat_id: chat, text: texto, parse_mode: 'HTML', reply_markup: botoes ? { inline_keyboard: botoes } : undefined });

const AJUDA = `<b>Como lançar</b> (é só escrever):
• <code>5,50 salgado nubank</code> → compra no cartão
• <code>120 tênis inter 3x</code> → R$ 120 em 3x
• <code>pix 50 mercado itaú</code> → pago da conta
• <code>débito 30 padaria nubank</code> → pago da conta
• <code>recebi 1800 seguro nubank</code> → entrada
• <code>ontem 40 ifood nubank</code> ou <code>12/11 ...</code> → outra data

O bot acha o cartão/conta pelo nome e sugere a categoria. Depois é só tocar em <b>Mudar categoria</b> ou <b>Desfazer</b>.
Comandos: /ajuda · /contas`;

// ---------------- Interpretação ----------------
function interpretar(texto, carteiras) {
  const t = norm(texto).replace(/r\$\s*/g, '');
  let tipo = 'compra';
  if (/^(recebi|entrada|ganhei|caiu|salario)\b/.test(t)) tipo = 'entrada';
  else if (/\b(pix|debito|paguei no debito|boleto)\b/.test(t)) tipo = 'conta';
  let data = hojeSP();
  if (/\bontem\b/.test(t)) data = hojeSP(-1);
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})\b(?!\d)/);
  let resto = t;
  if (dm) { const y = hojeSP().slice(0, 4); data = `${y}-${pad(dm[2])}-${pad(dm[1])}`; resto = resto.replace(dm[0], ' '); }
  const pm = resto.match(/\b(\d{1,2})\s*x\b/); const parcelas = pm ? Number(pm[1]) : 1; if (pm) resto = resto.replace(pm[0], ' ');
  const vm = resto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!vm) return { erro: 'Não achei o valor. Ex.: <code>5,50 salgado nubank</code>' };
  let vs = vm[1]; vs = vs.includes(',') ? vs.replace(/\./g, '').replace(',', '.') : (/^\d{1,3}(\.\d{3})+$/.test(vs) ? vs.replace(/\./g, '') : vs);
  const valor = Math.round(parseFloat(vs) * 100) / 100;
  resto = resto.replace(vm[1], ' ');
  const tokens = resto.split(/[^a-z0-9+]+/).filter(Boolean);
  // Cartão/conta pelo nome
  const cands = carteiras.map((c) => {
    const pal = norm(c.nome).split(/[^a-z0-9+]+/).filter((w) => w.length >= 2 && !GENERICAS.has(w));
    const hits = pal.filter((w) => tokens.includes(w) || (w === 'mercado' && tokens.includes('mp')));
    return { c, hits, score: hits.length };
  }).filter((x) => x.score > 0);
  const quer = tipo === 'compra' ? 'cartao' : 'conta';
  cands.sort((a, b) => b.score - a.score || (b.c.tipo === quer) - (a.c.tipo === quer) || (a.c.tipo !== 'cartao' && quer !== 'cartao' ? 0 : 0));
  let cart = cands[0]?.c || null;
  if (cart && tipo === 'compra' && cart.tipo !== 'cartao') tipo = 'conta';
  if (cart && tipo === 'conta' && cart.tipo === 'cartao') tipo = 'compra';
  const usados = new Set(cart ? norm(cart.nome).split(/[^a-z0-9+]+/).filter(Boolean) : []);
  const descTokens = tokens.filter((w) => !usados.has(w) && !PARADAS.has(w) && w !== 'mp');
  const textoOrig = texto.split(/\s+/).filter((w) => descTokens.includes(norm(w).replace(/[^a-z0-9+]/g, '')));
  let descricao = textoOrig.join(' ').trim();
  const nd = norm(descricao + ' ' + texto);
  const categoria = REGRAS.find(([rx]) => rx.test(nd))?.[1] || 'Outros';
  if (!descricao) descricao = categoria;
  descricao = descricao.charAt(0).toUpperCase() + descricao.slice(1);
  if (!(valor > 0)) return { erro: 'Valor inválido.' };
  return { tipo, valor, data, parcelas, cart, descricao, categoria };
}

async function lancar(env, chat, texto) {
  const carteiras = await listar(env, 'carteiras');
  const x = interpretar(texto, carteiras);
  if (x.erro) return responder(env, chat, x.erro + '\n\n/ajuda');
  if (!x.cart && x.tipo !== 'entrada') {
    const nomes = carteiras.map((c) => `• ${c.nome}`).join('\n');
    return responder(env, chat, `Não identifiquei o cartão ou a conta. Escreva o nome junto, ex.: <code>${texto} nubank</code>\n\nSeus cartões e contas:\n${nomes}`);
  }
  let col; let doc; let linha;
  if (x.tipo === 'compra') {
    col = 'compras';
    doc = { carteiraId: x.cart.id, descricao: x.descricao, valor: x.valor, data: x.data, parcelas: x.parcelas, categoria: x.categoria, origem: 'telegram' };
    linha = `💳 <b>${brl(x.valor)}</b>${x.parcelas > 1 ? ` em ${x.parcelas}x de ${brl(x.valor / x.parcelas)}` : ''} · ${x.descricao}\n${x.cart.nome} · fatura de ${mesFatura(x.cart, x.data)}`;
  } else if (x.tipo === 'conta') {
    col = 'contas';
    doc = { descricao: x.descricao, valor: x.valor, data: x.data, categoria: x.categoria, carteiraId: x.cart.id, pago: true, pagoEm: x.data, origem: 'telegram' };
    linha = `🏦 <b>${brl(x.valor)}</b> · ${x.descricao}\nPago com ${x.cart.nome}`;
  } else {
    col = 'entradas';
    doc = { descricao: x.descricao, valor: x.valor, data: x.data, carteiraId: x.cart ? x.cart.id : null, origem: 'telegram' };
    linha = `💰 <b>+ ${brl(x.valor)}</b> · ${x.descricao}${x.cart ? `\nEm ${x.cart.nome}` : ''}`;
  }
  const criado = await fs(env, 'POST', col, paraFS(doc));
  const id = criado.name.split('/').pop();
  const cod = col === 'compras' ? 'p' : col === 'contas' ? 'c' : 'e';
  const botoes = [[{ text: '🏷️ Mudar categoria', callback_data: `cat:${cod}:${id}` }, { text: '↩️ Desfazer', callback_data: `del:${cod}:${id}` }]];
  return responder(env, chat, `✅ Lançado\n${linha}\n🏷️ ${col === 'entradas' ? 'Entrada' : x.categoria}${x.data !== hojeSP() ? ` · ${x.data.slice(8)}/${x.data.slice(5, 7)}` : ''}`, col === 'entradas' ? [[botoes[0][1]]] : botoes);
}

const COLS = { p: 'compras', c: 'contas', e: 'entradas' };
async function callback(env, q) {
  const [acao, cod, id, extra] = q.data.split(':');
  const col = COLS[cod]; const chat = q.message.chat.id; const msg = q.message.message_id;
  if (acao === 'del') {
    await fs(env, 'DELETE', `${col}/${id}`);
    await tg(env, 'editMessageText', { chat_id: chat, message_id: msg, text: '↩️ Lançamento desfeito.' });
  } else if (acao === 'cat') {
    const linhas = []; for (let i = 0; i < CATS.length; i += 3) linhas.push(CATS.slice(i, i + 3).map((c, j) => ({ text: c, callback_data: `set:${cod}:${id}:${i + j}` })));
    await tg(env, 'editMessageReplyMarkup', { chat_id: chat, message_id: msg, reply_markup: { inline_keyboard: linhas } });
  } else if (acao === 'set') {
    const cat = CATS[Number(extra)];
    await fs(env, 'PATCH', `${col}/${id}?updateMask.fieldPaths=categoria`, paraFS({ categoria: cat }));
    await tg(env, 'editMessageText', { chat_id: chat, message_id: msg, text: q.message.text.replace(/🏷️ .*$/m, `🏷️ ${cat}`), reply_markup: { inline_keyboard: [[{ text: '🏷️ Mudar categoria', callback_data: `cat:${cod}:${id}` }, { text: '↩️ Desfazer', callback_data: `del:${cod}:${id}` }]] } });
  }
  return tg(env, 'answerCallbackQuery', { callback_query_id: q.id });
}

export { interpretar };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // Configuração única: abra https://SEU-WORKER.workers.dev/setup?key=SEU_WEBHOOK_SECRET
    if (url.pathname === '/setup') {
      if (url.searchParams.get('key') !== env.WEBHOOK_SECRET) return new Response('chave errada', { status: 403 });
      const r = await tg(env, 'setWebhook', { url: `${url.origin}/telegram`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'] });
      await tg(env, 'setMyCommands', { commands: [{ command: 'ajuda', description: 'Como lançar gastos' }, { command: 'contas', description: 'Seus cartões e contas' }] });
      return new Response(r.ok ? '✅ Bot conectado! Agora mande /start para ele no Telegram.' : 'Erro: ' + JSON.stringify(r), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname !== '/telegram' || req.method !== 'POST') return new Response('Minhas Finanças bot ✓');
    if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('proibido', { status: 403 });
    const up = await req.json();
    const chat = up.message?.chat?.id ?? up.callback_query?.message?.chat?.id;
    const texto = (up.message?.text || '').trim();
    try {
      if (texto === '/start') {
        return Response.json(await responder(env, chat, `👋 Olá! Seu chat id é <code>${chat}</code>.\n${String(chat) === String(env.ALLOWED_CHAT) ? '✅ Bot liberado para você.' : '⚠️ Cole esse número na variável <b>ALLOWED_CHAT</b> do Worker para liberar o bot.'}\n\n${AJUDA}`));
      }
      if (String(chat) !== String(env.ALLOWED_CHAT)) return new Response('ok');
      if (up.callback_query) { await callback(env, up.callback_query); return new Response('ok'); }
      if (texto === '/ajuda' || texto === '/help') await responder(env, chat, AJUDA);
      else if (texto === '/contas') { const cs = await listar(env, 'carteiras'); await responder(env, chat, cs.map((c) => `${c.tipo === 'cartao' ? '💳' : '🏦'} ${c.nome}`).join('\n') || 'Nenhuma cadastrada.'); }
      else if (texto) await lancar(env, chat, texto);
    } catch (e) {
      await responder(env, chat, '⚠️ Erro: ' + String(e.message || e).slice(0, 300));
    }
    return new Response('ok');
  },
};
