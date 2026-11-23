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
    async exportarTudo() { return ler(); },
    async apagarTudo() { gravar(vazio()); },
    async excluirConta() { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-logado'); onAuth(null); },
  };
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
