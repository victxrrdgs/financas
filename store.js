// Camada de dados: Firebase (Auth + Firestore) quando configurado,
// ou modo local (localStorage) para testes quando firebase-config.js está vazio.
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const COLS = ['contas', 'entradas', 'recorrentes'];

export const modoLocal = !firebaseConfig || !firebaseConfig.apiKey;

function intervaloMes(ym) {
  return [ym + '-01', ym + '-31'];
}

// ---------------- Modo local ----------------
function criarStoreLocal() {
  const KEY = 'financas-local-v1';
  const ler = () => JSON.parse(localStorage.getItem(KEY) || '{"contas":{},"entradas":{},"recorrentes":{}}');
  const gravar = (d) => { localStorage.setItem(KEY, JSON.stringify(d)); ouvintes.forEach((f) => f()); };
  const ouvintes = new Set();
  const novoId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const usuario = { uid: 'local', displayName: 'Modo local (teste)', email: 'dados só neste navegador' };

  return {
    async init(onAuth) { onAuth(localStorage.getItem(KEY + '-logado') ? usuario : null); this._onAuth = onAuth; },
    async entrar() { localStorage.setItem(KEY + '-logado', '1'); this._onAuth(usuario); },
    async sair() { localStorage.removeItem(KEY + '-logado'); this._onAuth(null); },
    assinarMes(ym, cb) {
      const [ini, fim] = intervaloMes(ym);
      const emitir = () => {
        const d = ler();
        const filtra = (c) => Object.entries(d[c]).map(([id, v]) => ({ id, ...v })).filter((x) => x.data >= ini && x.data <= fim);
        cb({ contas: filtra('contas'), entradas: filtra('entradas'), doServidor: true });
      };
      ouvintes.add(emitir); emitir();
      return () => ouvintes.delete(emitir);
    },
    assinarRecorrentes(cb) {
      const emitir = () => cb(Object.entries(ler().recorrentes).map(([id, v]) => ({ id, ...v })), true);
      ouvintes.add(emitir); emitir();
      return () => ouvintes.delete(emitir);
    },
    assinarStatus(cb) { cb('Modo local — sem sincronização'); },
    novoId,
    async adicionar(col, dados) { const d = ler(); const id = novoId(); d[col][id] = dados; gravar(d); return id; },
    async definir(col, id, dados) { const d = ler(); d[col][id] = dados; gravar(d); },
    async atualizar(col, id, dados) { const d = ler(); d[col][id] = { ...d[col][id], ...dados }; gravar(d); },
    async remover(col, id) { const d = ler(); delete d[col][id]; gravar(d); },
    async exportarTudo() { return ler(); },
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
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  let uid = null;
  const col = (c) => fs.collection(db, 'usuarios', uid, c);
  const mapear = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return {
    async init(onAuth) {
      try { await auth.getRedirectResult(a); } catch (e) { console.warn(e); }
      auth.onAuthStateChanged(a, (u) => { uid = u ? u.uid : null; onAuth(u); });
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
    assinarMes(ym, cb) {
      const [ini, fim] = intervaloMes(ym);
      const estado = { contas: null, entradas: null, srvC: false, srvE: false };
      const emitir = () => {
        if (estado.contas && estado.entradas) {
          cb({ contas: estado.contas, entradas: estado.entradas, doServidor: estado.srvC && estado.srvE });
        }
      };
      const q = (c) => fs.query(col(c), fs.where('data', '>=', ini), fs.where('data', '<=', fim));
      const u1 = fs.onSnapshot(q('contas'), { includeMetadataChanges: true }, (s) => {
        estado.contas = mapear(s); estado.srvC = !s.metadata.fromCache; emitir();
      }, (e) => console.error(e));
      const u2 = fs.onSnapshot(q('entradas'), { includeMetadataChanges: true }, (s) => {
        estado.entradas = mapear(s); estado.srvE = !s.metadata.fromCache; emitir();
      }, (e) => console.error(e));
      return () => { u1(); u2(); };
    },
    assinarRecorrentes(cb) {
      return fs.onSnapshot(col('recorrentes'), { includeMetadataChanges: true }, (s) => cb(mapear(s), !s.metadata.fromCache), (e) => console.error(e));
    },
    assinarStatus(cb) {
      const at = () => cb(navigator.onLine ? 'Sincronizado' : 'Offline — sincroniza ao voltar');
      window.addEventListener('online', at); window.addEventListener('offline', at); at();
    },
    novoId: () => fs.doc(fs.collection(db, '_')).id,
    async adicionar(c, dados) { const r = fs.doc(col(c)); fs.setDoc(r, dados); return r.id; },
    async definir(c, id, dados) { fs.setDoc(fs.doc(col(c), id), dados); },
    async atualizar(c, id, dados) { fs.updateDoc(fs.doc(col(c), id), dados); },
    async remover(c, id) { fs.deleteDoc(fs.doc(col(c), id)); },
    async exportarTudo() {
      const out = {};
      for (const c of COLS) out[c] = mapear(await fs.getDocs(col(c)));
      return out;
    },
  };
}

export async function criarStore() {
  return modoLocal ? criarStoreLocal() : criarStoreFirebase();
}
