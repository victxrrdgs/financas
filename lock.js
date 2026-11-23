// Bloqueio do app neste aparelho: PIN (sempre) + biometria opcional (WebAuthn / passkey do aparelho).
// A configuração fica só no aparelho (localStorage); nada disso vai para o servidor.
// É uma trava de conveniência contra quem pegar o celular desbloqueado, não criptografia dos dados.

const KEY = 'fin-lock';
export const config = () => JSON.parse(localStorage.getItem(KEY) || 'null');
export const salvar = (c) => (c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY));

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function bioDisponivel() {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    return false;
  }
}

export async function hashPin(pin, salt) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return b64(d);
}

export async function criarPin(pin) {
  const salt = b64(rnd(16));
  return { salt, pinHash: await hashPin(pin, salt), pinLen: pin.length };
}

export async function conferePin(pin) {
  const c = config();
  return !!c && (await hashPin(pin, c.salt)) === c.pinHash;
}

export async function criarBio(nome) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rnd(32),
      rp: { name: 'Minhas Finanças', id: location.hostname },
      user: { id: rnd(16), name: nome || 'usuario', displayName: nome || 'Usuário' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  return b64(cred.rawId);
}

export async function verificarBio() {
  const c = config();
  if (!c || !c.credId) return false;
  await navigator.credentials.get({
    publicKey: {
      challenge: rnd(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64(c.credId) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return true;
}
