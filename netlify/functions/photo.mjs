// My I-Car — photos des permis de conduire (Netlify Blobs, gratuit).
// Rangées à part de la base de l'atelier pour qu'elle reste légère :
// chaque synchro n'envoie que le numéro de la photo, pas la photo elle-même.
// Protégées par le même code d'équipe que la base (variable CODE_EQUIPE).
import { getStore } from '@netlify/blobs';
import { verifier, json } from '../lib/acces.mjs';

const TAILLE_MAX = 1_500_000;


export default async (req) => {
  const qui = await verifier(req);
  if (qui instanceof Response) return qui;

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
