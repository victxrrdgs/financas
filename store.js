// Camada de dados: Firebase (Auth + Firestore) quando configurado,
// ou modo local (localStorage) para testes (firebase-config.js vazio ou ?local na URL).
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
export const COLECOES = ['contas', 'entradas', 'recorrentes', 'carteiras', 'compras', 'faturas', 'transferencias', 'orcamentos', 'metas', 'config', 'comissoes'];

export const modoLocal = !firebaseConfig || !firebaseConfig.apiKey || new URLSearchParams(location.search).has('local');

// ---------------- Modo local ----------------
function criarStoreLocal() {
  const KEY = 'financas-local-v2';
  const vazio = () => Object.fromEntries(COLECOES.map((c) => [c, {}]));
  const ler = () => ({ ...vazio(), ...JSON.parse(localStorage.getItem(KEY) || '{}') });
  const ouvintes = new Set();
  const gravar = (d) => { localStorage.setItem(KEY, JSON.stringify(d)); ouvintes.forEach((f) => f()); };
  const novoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const usuario = { uid: 'local', displayName: 'Victor (modo local)', email: 'dados só neste navegador' };
  let onAuth = () => {};

  return {
    async init(cb) { onAuth = cb; cb(localStorage.getItem(KEY + '-logado') ? usuario : null); },
    async entrar() { localStorage.setItem(KEY + '-logado', '1'); onAuth(usuario); },
    async sair() { localStorage.removeItem(KEY + '-logado'); onAuth(null); },
    assinar(col, cb) {
      const emitir = () => cb(Object.entries(ler()[col]).map(([id, v]) => ({ id, ...v })), true);
      ouvintes.add(emitir); emitir();
      return () => ouvintes.delete(emitir);
    },
    assinarStatus(cb) { cb('Modo local'); },
    novoId,
    async adicionar(col, dados) { const d = ler(); const id = novoId(); d[col][id] = dados; gravar(d); return id; },
    async definir(col, id, dados) { const d = ler(); d[col][id] = dados; gravar(d); },
    async atualizar(col, id, dados) { const d = ler(); d[col][id] = { ...d[col][id], ...dados }; gravar(d); },
    async remover(col, id) { const d = ler(); delete d[col][id]; gravar(d); },
    async criarVinculo() { throw new Error('Conectar Telegram não funciona no modo local.'); },
    ...criarDivisaoLocal(novoId),
    async exportarTudo() { return ler(); },
    async apagarTudo() { gravar(vazio()); },
    async excluirConta() { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-logado'); onAuth(null); },
  };
}

// Dividir contas no modo local: a outra pessoa é simulada ("Ana"), para testar sem o Firebase.
function criarDivisaoLocal(novoId) {
  const KEY = 'financas-local-div';
  const EU = 'local';
  const OUTRA = { uid: 'local-outra', nome: 'Ana (simulada)' };
  const ler = () => ({ conexoes: {}, itens: {}, acertos: {}, convites: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') });
  const ouvintes = new Set();
  const gravar = (d) => { localStorage.setItem(KEY, JSON.stringify(d)); ouvintes.forEach((f) => f()); };
  const lista = (o) => Object.entries(o || {}).map(([id, v]) => ({ id, ...v }));
  const ouvir = (emitir) => { ouvintes.add(emitir); emitir(); return () => ouvintes.delete(emitir); };
  const conectar = (d, cid, membros, nomes) => { d.conexoes[cid] = { membros, nomes, criadoEm: Date.now() }; delete d.convites[cid]; };
  const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const exemplos = [['Mercado', 'Alimentação', 184.6], ['Pizza de sexta', 'Restaurantes', 92], ['Uber para a festa', 'Transporte', 38.4], ['Conta de luz', 'Água/Luz/Internet', 210.35], ['Presente da sua mãe', 'Compras', 120]];

  return {
    assinarConexoes(cb) { return ouvir(() => cb(lista(ler().conexoes).filter((c) => c.membros.includes(EU)))); },
    assinarDivisao(cid, cb) { return ouvir(() => { const d = ler(); cb(lista(d.itens[cid]), lista(d.acertos[cid])); }); },
    async criarConvite(nome) {
      const d = ler(); const cod = gerarCodigo();
      d.convites[cod] = { uid: EU, nome, expira: Date.now() + VALIDADE_CONVITE }; gravar(d); return cod;
    },
    // Qualquer código que não seja um convite seu vira um convite da pessoa simulada.
    async lerConvite(cod) { return ler().convites[cod] || { uid: OUTRA.uid, nome: OUTRA.nome, expira: Date.now() + VALIDADE_CONVITE }; },
    async aceitarConvite(cod, conv, meuNome) { const d = ler(); conectar(d, cod, [conv.uid, EU], { [conv.uid]: conv.nome, [EU]: meuNome }); gravar(d); },
    async cancelarConvite(cod) { const d = ler(); delete d.convites[cod]; gravar(d); },
    async sairConexao(c) { const d = ler(); Object.assign(d.conexoes[c.id], { membros: c.membros.filter((x) => x !== EU), saiu: EU }); gravar(d); },
    async apagarConexao(cid) { const d = ler(); delete d.conexoes[cid]; delete d.itens[cid]; delete d.acertos[cid]; gravar(d); },
    async definirItem(cid, id, dados) { const d = ler(); (d.itens[cid] ||= {})[id] = dados; gravar(d); },
    async atualizarItem(cid, id, mud) { const d = ler(); const it = d.itens[cid]?.[id]; if (it) { Object.assign(it, mud); gravar(d); } },
    async removerItem(cid, id) { const d = ler(); if (d.itens[cid]) delete d.itens[cid][id]; gravar(d); },
    async acertar(cid, acerto) {
      const d = ler(); const id = novoId();
      (d.acertos[cid] ||= {})[id] = acerto;
      acerto.itens.forEach((i) => { const it = d.itens[cid]?.[i]; if (it) Object.assign(it, { pago: true, pagoEm: acerto.data, pagoPor: acerto.criadoPor, acertoId: id }); });
      gravar(d);
    },
    // Botões de teste que só existem no modo local.
    simular: {
      aceite(cod) { const d = ler(); const meu = d.convites[cod]; if (!meu) return; conectar(d, cod, [EU, OUTRA.uid], { [EU]: meu.nome, [OUTRA.uid]: OUTRA.nome }); gravar(d); },
      item(cid) {
        const d = ler(); const [descricao, categoria, valor] = exemplos[Math.floor(Math.random() * exemplos.length)];
        const pagou = Math.random() < 0.6 ? OUTRA.uid : EU;
        (d.itens[cid] ||= {})[novoId()] = { descricao, categoria, valor, data: hoje(), pagou, parte: Math.round(valor * 50) / 100, divisao: 'metade', criadoPor: OUTRA.uid, criadoEm: Date.now(), pago: false, pagoEm: null, lancado: false };
        gravar(d);
      },
      sair(cid) { const d = ler(); const c = d.conexoes[cid]; if (!c) return; c.membros = c.membros.filter((x) => x !== OUTRA.uid); c.saiu = OUTRA.uid; gravar(d); },
    },
  };
}

// Código do convite para dividir contas: 10 letras/números fáceis de ditar (sem 0/o/1/l).
// Validade de 47 h: a regra aceita até 48 h, e a folga cobre relógio do celular adiantado.
const VALIDADE_CONVITE = 47 * 60 * 60 * 1000;
function gerarCodigo() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint8Array(10); crypto.getRandomValues(b);
  return Array.from(b, (x) => abc[x % abc.length]).join('');
}

// ---------------- Firebase ----------------
async function criarStoreFirebase() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  let uid = null;
  const col = (c) => fs.collection(db, 'usuarios', uid, c);
  const mapear = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return {
    async init(cb) {
      try { await auth.getRedirectResult(a); } catch (e) { console.warn(e); }
      auth.onAuthStateChanged(a, (u) => { uid = u ? u.uid : null; cb(u); });
    },
    async entrar() {
      const prov = new auth.GoogleAuthProvider();
      prov.setCustomParameters({ prompt: 'select_account' });
      try {
        await auth.signInWithPopup(a, prov);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await auth.signInWithRedirect(a, prov);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    async sair() { await auth.signOut(a); },
    assinar(c, cb) {
      return fs.onSnapshot(col(c), { includeMetadataChanges: true }, (s) => cb(mapear(s), !s.metadata.fromCache), (e) => console.error(c, e));
    },
    assinarStatus(cb) {
      const at = () => cb(navigator.onLine ? 'Sincronizado' : 'Offline');
      window.addEventListener('online', at); window.addEventListener('offline', at); at();
    },
    novoId: () => fs.doc(fs.collection(db, '_')).id,
    // Gravações não são aguardadas: funcionam offline e sincronizam depois.
    async adicionar(c, dados) { const r = fs.doc(col(c)); fs.setDoc(r, dados); return r.id; },
    async definir(c, id, dados) { fs.setDoc(fs.doc(col(c), id), dados); },
    async atualizar(c, id, dados) { fs.updateDoc(fs.doc(col(c), id), dados); },
    async remover(c, id) { fs.deleteDoc(fs.doc(col(c), id)); },
    // Código de uso único para ligar o Telegram a esta conta (o bot lê e apaga).
    async criarVinculo() {
      const b = new Uint8Array(12); crypto.getRandomValues(b);
      const cod = 'v' + Array.from(b, (x) => (x % 36).toString(36)).join('');
      await fs.setDoc(fs.doc(db, 'vinculos', cod), { uid, expira: Date.now() + 10 * 60 * 1000 });
      return cod;
    },
    // ----- Dividir contas: conexoes/{id} (id = código do convite), com itens/ e acertos/ -----
    assinarConexoes(cb) {
      const q = fs.query(fs.collection(db, 'conexoes'), fs.where('membros', 'array-contains', uid));
      return fs.onSnapshot(q, (s) => cb(mapear(s)), (e) => console.error('conexoes', e));
    },
    assinarDivisao(cid, cb) {
      let itens = []; let acertos = [];
      const u1 = fs.onSnapshot(fs.collection(db, 'conexoes', cid, 'itens'), (s) => { itens = mapear(s); cb(itens, acertos); }, (e) => console.error('itens', e));
      const u2 = fs.onSnapshot(fs.collection(db, 'conexoes', cid, 'acertos'), (s) => { acertos = mapear(s); cb(itens, acertos); }, (e) => console.error('acertos', e));
      return () => { u1(); u2(); };
    },
    async criarConvite(nome) {
      const cod = gerarCodigo();
      await fs.setDoc(fs.doc(db, 'convites', cod), { uid, nome, expira: Date.now() + VALIDADE_CONVITE });
      return cod;
    },
    async lerConvite(cod) {
      const s = await fs.getDoc(fs.doc(db, 'convites', cod));
      return s.exists() ? s.data() : null;
    },
    // Cria a conexão e apaga o convite na mesma gravação: o convite só pode ser aceito uma vez.
    async aceitarConvite(cod, conv, meuNome) {
      const b = fs.writeBatch(db);
      b.set(fs.doc(db, 'conexoes', cod), { membros: [conv.uid, uid], nomes: { [conv.uid]: conv.nome, [uid]: meuNome }, criadoEm: Date.now() });
      b.delete(fs.doc(db, 'convites', cod));
      await b.commit();
    },
    async cancelarConvite(cod) { await fs.deleteDoc(fs.doc(db, 'convites', cod)); },
    async sairConexao(c) { await fs.updateDoc(fs.doc(db, 'conexoes', c.id), { membros: c.membros.filter((x) => x !== uid), saiu: uid }); },
    // Só quem ficou sozinho na conexão apaga o histórico (itens, acertos e a conexão).
    async apagarConexao(cid) {
      for (const sub of ['itens', 'acertos']) {
        const docs = (await fs.getDocs(fs.collection(db, 'conexoes', cid, sub))).docs;
        for (let i = 0; i < docs.length; i += 400) {
          const b = fs.writeBatch(db);
          docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
          await b.commit();
        }
      }
      await fs.deleteDoc(fs.doc(db, 'conexoes', cid));
    },
    async definirItem(cid, id, dados) { fs.setDoc(fs.doc(db, 'conexoes', cid, 'itens', id), dados); },
    async atualizarItem(cid, id, mud) { fs.updateDoc(fs.doc(db, 'conexoes', cid, 'itens', id), mud); },
    async removerItem(cid, id) { fs.deleteDoc(fs.doc(db, 'conexoes', cid, 'itens', id)); },
    async acertar(cid, acerto) {
      const b = fs.writeBatch(db);
      const r = fs.doc(fs.collection(db, 'conexoes', cid, 'acertos'));
      b.set(r, acerto);
      acerto.itens.forEach((i) => b.update(fs.doc(db, 'conexoes', cid, 'itens', i), { pago: true, pagoEm: acerto.data, pagoPor: acerto.criadoPor, acertoId: r.id }));
      b.commit();
    },
    async exportarTudo() {
      const out = {};
      for (const c of COLECOES) out[c] = mapear(await fs.getDocs(col(c)));
      return out;
    },
    // Apaga todos os documentos do usuário e espera o servidor confirmar.
    async apagarTudo() {
      // Recorrências primeiro, para nenhum aparelho recriar lançamentos no meio da limpeza.
      for (const c of ['recorrentes', ...COLECOES.filter((x) => x !== 'recorrentes')]) {
        const docs = (await fs.getDocs(col(c))).docs;
        for (let i = 0; i < docs.length; i += 400) {
          const b = fs.writeBatch(db);
          docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
          await b.commit();
        }
      }
    },
    async excluirConta() {
      const u = a.currentUser;
      if (!u) return;
      try {
        await auth.deleteUser(u);
      } catch (e) {
        if (e.code !== 'auth/requires-recent-login') throw e;
        await auth.reauthenticateWithPopup(u, new auth.GoogleAuthProvider());
        await auth.deleteUser(u);
      }
    },
  };
}

export async function criarStore() {
  return modoLocal ? criarStoreLocal() : criarStoreFirebase();
}
