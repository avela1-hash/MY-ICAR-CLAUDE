// My I-Car — photos des permis de conduire (Netlify Blobs, gratuit).
// Rangées à part de la base de l'atelier pour qu'elle reste légère :
// chaque synchro n'envoie que le numéro de la photo, pas la photo elle-même.
// Protégées par le même code d'équipe que la base (variable CODE_EQUIPE).
import { getStore } from '@netlify/blobs';

const env = (k) => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const TAILLE_MAX = 1_500_000;

function egal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default async (req) => {
  const code = String(env('CODE_EQUIPE') || '').trim();
  if (!code) return json({ erreur: 'base non configurée : ajoute la variable CODE_EQUIPE sur Netlify', configuree: false }, 503);
  const recu = String(req.headers.get('x-code-equipe') || '').trim();
  if (!recu || !egal(recu, code)) return json({ erreur: 'code d’équipe incorrect' }, 401);

  const store = getStore({ name: 'myicar-photos', consistency: 'strong' });

  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!/^[a-z0-9]{8,40}$/.test(id)) return json({ erreur: 'photo inconnue' }, 400);
    const data = await store.get(id, { type: 'text' });
    return data ? json({ data }) : json({ erreur: 'photo introuvable' }, 404);
  }

  if (req.method === 'POST') {
    const texte = await req.text();
    if (texte.length > TAILLE_MAX) return json({ erreur: 'photo trop lourde' }, 413);
    let corps;
    try { corps = JSON.parse(texte); } catch { return json({ erreur: 'photo illisible' }, 400); }
    const data = String(corps?.data || '');
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(data)) return json({ erreur: 'ce n’est pas une photo' }, 400);
    const id = crypto.randomUUID().replace(/-/g, '');
    await store.set(id, data);
    return json({ id });
  }

  return json({ erreur: 'méthode non autorisée' }, 405);
};

export const config = { path: '/api/photo' };
