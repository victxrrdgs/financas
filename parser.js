// Lê um lançamento escrito em uma linha ("50 salgado nubank").
// Manter em sincronia com interpretar() em bot/apps-script.gs (o Apps Script não importa módulos).

const REGRAS = [
  [/uber|99|cabify|posto|gasolina|combust|estacion|pedagio|onibus|metro|bilhete/, 'Transporte'],
  [/ifood|restaurante|lanche|lanchonete|burger|mc ?donald|pizza|salgado|coxinha|pastel|cafe|acai|sorvete|\bbar\b|cerveja|almoco|janta|marmita|sushi/, 'Restaurantes'],
  [/mercado|supermerc|padaria|feira|hortifruti|acougue|atacad|assai|carrefour|\bpao\b/, 'Alimentação'],
  [/netflix|spotify|youtube|disney|hbo|prime|deezer|apple|google one|icloud|claude|chatgpt|duolingo|meli|globoplay/, 'Assinaturas'],
  [/farmacia|remedio|drogaria|medico|consulta|exame|dentista|hospital|academia|petlove/, 'Saúde'],
  [/aluguel|condominio|iptu|\bluz\b|\bagua\b|\bgas\b/, 'Moradia'],
  [/vivo|claro|\btim\b|internet|celular|telefone/, 'Água/Luz/Internet'],
  [/curso|livro|escola|faculdade|udemy|alura/, 'Educação'],
  [/cinema|show|ingresso|jogo|steam|viagem|hotel|airbnb|passeio/, 'Lazer'],
  [/roupa|tenis|camisa|shopee|amazon|mercado ?livre|shein|loja|presente|riachuelo|renner/, 'Compras'],
];
const PARADAS = ['no', 'na', 'do', 'da', 'de', 'em', 'com', 'cartao', 'credito', 'debito', 'pix', 'paguei', 'gastei', 'comprei', 'recebi', 'entrada', 'ganhei', 'reais', 'r', 'hoje', 'ontem', 'conta', 'pelo', 'pela', 'um', 'uma', 'o', 'a', 'mp'];
const GENERICAS = ['linha', 'credito', 'gold', 'platinum', 'conta', 'cartao', 'de', 'do', 'da'];

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = (n) => String(n).padStart(2, '0');
function hojeSP(delta = 0) {
  const d = new Date(Date.now() + delta * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

// Mesmo retorno do bot: { tipo: 'compra'|'conta'|'entrada', valor, data, parcelas, cart, descricao, categoria } ou { erro }.
export function interpretar(texto, carteiras) {
  const t = norm(texto).replace(/r\$\s*/g, '');
  let tipo = 'compra';
  if (/^(recebi|entrada|ganhei|caiu|salario)\b/.test(t)) tipo = 'entrada';
  else if (/\b(pix|debito|boleto)\b/.test(t)) tipo = 'conta';
  let data = hojeSP(0);
  if (/\bontem\b/.test(t)) data = hojeSP(-1);
  let resto = t;
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})\b(?!\d)/);
  if (dm) { data = `${hojeSP(0).slice(0, 4)}-${pad(dm[2])}-${pad(dm[1])}`; resto = resto.replace(dm[0], ' '); }
  const pm = resto.match(/\b(\d{1,2})\s*x\b/); const parcelas = pm ? Number(pm[1]) : 1; if (pm) resto = resto.replace(pm[0], ' ');
  const vm = resto.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!vm) return { erro: 'Escreva o valor. Ex.: 50 salgado nubank' };
  let vs = vm[1];
  vs = vs.includes(',') ? vs.replace(/\./g, '').replace(',', '.') : (/^\d{1,3}(\.\d{3})+$/.test(vs) ? vs.replace(/\./g, '') : vs);
  const valor = Math.round(parseFloat(vs) * 100) / 100;
  if (!(valor > 0)) return { erro: 'Valor inválido.' };
  resto = resto.replace(vm[1], ' ');
  const tokens = resto.split(/[^a-z0-9+]+/).filter(Boolean);
  const quer = tipo === 'compra' ? 'cartao' : 'conta';
  const cands = carteiras.map((c) => {
    const pal = norm(c.nome).split(/[^a-z0-9+]+/).filter((w) => w.length >= 2 && !GENERICAS.includes(w));
    const hits = pal.filter((w) => tokens.includes(w) || (w === 'mercado' && tokens.includes('mp')));
    return { c, score: hits.length };
  }).filter((x) => x.score > 0);
  cands.sort((a, b) => b.score - a.score || ((b.c.tipo === quer) - (a.c.tipo === quer)));
  const cart = cands.length ? cands[0].c : null;
  if (cart && tipo === 'compra' && cart.tipo !== 'cartao') tipo = 'conta';
  if (cart && tipo === 'conta' && cart.tipo === 'cartao') tipo = 'compra';
  const usados = cart ? norm(cart.nome).split(/[^a-z0-9+]+/).filter(Boolean) : [];
  const desc = tokens.filter((w) => !usados.includes(w) && !PARADAS.includes(w));
  let descricao = texto.split(/\s+/).filter((w) => desc.includes(norm(w).replace(/[^a-z0-9+]/g, ''))).join(' ').trim();
  const nd = norm(`${descricao} ${texto}`);
  let categoria = 'Outros';
  for (const [re, cat] of REGRAS) if (re.test(nd)) { categoria = cat; break; }
  if (!descricao) descricao = categoria;
  descricao = descricao.charAt(0).toUpperCase() + descricao.slice(1);
  return { tipo, valor, data, parcelas, cart, descricao, categoria, _valorTxt: vm[1], _cartPal: usados };
}

// Divide o texto em pedaços marcados para o destaque no campo: valor, carteira ou descrição.
export function marcar(texto, x) {
  if (!x || x.erro) return [{ t: texto, c: '' }];
  return texto.split(/(\s+)/).map((w) => {
    if (!w.trim()) return { t: w, c: '' };
    const n = norm(w).replace(/^r\$/, '').replace(/[^a-z0-9+.,]/g, '');
    if (x._valorTxt && n === x._valorTxt) return { t: w, c: 'tk-valor' };
    if (x._cartPal.includes(n.replace(/[^a-z0-9+]/g, ''))) return { t: w, c: 'tk-cart' };
    if (norm(x.descricao).split(/\s+/).includes(n.replace(/[^a-z0-9+]/g, ''))) return { t: w, c: 'tk-desc' };
    return { t: w, c: '' };
  });
}
