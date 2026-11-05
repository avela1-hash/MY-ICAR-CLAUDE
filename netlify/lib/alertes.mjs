// My I-Car — alertes sur le téléphone (notifications Web Push, normes RFC 8291 / 8292).
// Tout est fait avec le module crypto de Node : aucune librairie externe.
// Les clés VAPID sont créées toutes seules au premier usage et rangées dans la base :
// rien à régler sur Netlify.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const magasin = () => getStore({ name: 'myicar', consistency: 'strong' });
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const deB64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (cle, ...data) => crypto.createHmac('sha256', cle).update(Buffer.concat(data)).digest();

export function nouvellesCles() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), deB64u(j.x), deB64u(j.y)])), privateKey: j.d };
}

export async function clesVapid() {
  const s = magasin();
  let k = await s.get('vapid', { type: 'json' });
  if (!k || !k.publicKey || !k.privateKey) {
    k = nouvellesCles();
    await s.setJSON('vapid', k);
  }
  return k;
}

export async function abonnes() {
  return (await magasin().get('abonnes', { type: 'json' })) || [];
}
export async function ecrireAbonnes(l) {
  await magasin().setJSON('abonnes', l);
}

// Jeton VAPID (JWT ES256) pour le service de notification du téléphone.
export function enteteVapid(endpoint, k) {
  const pub = deB64u(k.publicKey);
  const cle = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: k.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const tete = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corps = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:contact@myicar.invalid' }));
  const sig = crypto.sign('sha256', Buffer.from(tete + '.' + corps), { key: cle, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${tete}.${corps}.${b64u(sig)}, k=${k.publicKey}`;
}

// Chiffrement aes128gcm du message pour un abonnement.
export function chiffrer(sub, texte) {
  const uaPub = deB64u(sub.keys.p256dh), auth = deB64u(sub.keys.auth);
  const eph = crypto.createECDH('prime256v1'); eph.generateKeys();
  const asPub = eph.getPublicKey(), secret = eph.computeSecret(uaPub);
  const prkCle = hmac(auth, secret);
  const ikm = hmac(prkCle, Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1]));
  const sel = crypto.randomBytes(16);
  const prk = hmac(sel, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const chiffre = Buffer.concat([c.update(Buffer.concat([Buffer.from(texte), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sel, rs, Buffer.from([asPub.length]), asPub, chiffre]);
}

// Envoie à tous les téléphones abonnés (ou à ceux d'une personne). Retire les abonnements morts.
export async function envoyer(message, { nom } = {}) {
  const k = await clesVapid();
  const liste = await abonnes();
  const cibles = liste.filter(a => !nom || a.nom === nom);
  let ok = 0; const morts = [], erreurs = [];
  await Promise.all(cibles.map(async a => {
    try {
      const r = await fetch(a.sub.endpoint, {
        method: 'POST',
        headers: { Authorization: enteteVapid(a.sub.endpoint, k), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(6 * 3600), Urgency: 'high' },
        body: chiffrer(a.sub, JSON.stringify(message))
      });
      if (r.ok) ok++;
      else if (r.status === 404 || r.status === 410) morts.push(a.sub.endpoint);
      else erreurs.push(r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
    } catch (e) { erreurs.push(String(e && e.message || e).slice(0, 120)); }
  }));
  if (morts.length) await ecrireAbonnes(liste.filter(a => !morts.includes(a.sub.endpoint)));
  return { envoyes: ok, cibles: cibles.length, erreurs };
}
