// My I-Car — contrôle d'accès.
// CODE_EQUIPE (variable Netlify) = code du patron : accès total + gestion des accès.
// Chaque membre de l'équipe a son propre code, que le patron peut couper à tout moment.
import { getStore } from '@netlify/blobs';

export const env = (k) => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];
export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export function egal(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const magasin = () => getStore({ name: 'myicar', consistency: 'strong' });

export async function listeAcces() {
  return (await magasin().get('acces', { type: 'json' })) || [];
}
export async function ecrireAcces(liste) {
  await magasin().setJSON('acces', liste);
}

// Renvoie { role:'admin'|'membre', nom } ou une Response d'erreur.
export async function verifier(req) {
  const patron = String(env('CODE_EQUIPE') || '').trim();
  if (!patron) return json({ erreur: 'base non configurée : ajoute la variable CODE_EQUIPE sur Netlify', configuree: false }, 503);
  const recu = String(req.headers.get('x-code-equipe') || '').trim();
  if (!recu) return json({ erreur: 'code d’équipe incorrect' }, 401);
  if (egal(recu, patron)) return { role: 'admin', nom: 'Aurel' };
  const m = (await listeAcces()).find(p => p.actif && egal(p.code, recu));
  if (m) return { role: 'membre', nom: m.nom };
  return json({ erreur: 'code d’équipe incorrect' }, 401);
}
