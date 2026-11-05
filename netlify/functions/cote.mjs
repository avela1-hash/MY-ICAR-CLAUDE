// My I-Car — résultat de la recherche de cote lancée par cote-background.
import { getStore } from '@netlify/blobs';
import { verifier, json } from '../lib/acces.mjs';

export default async (req) => {
  const qui = await verifier(req);
  if (qui instanceof Response) return qui;
  const id = String(new URL(req.url).searchParams.get('id') || '').replace(/[^\w-]/g, '').slice(0, 60);
  if (!id) return json({ erreur: 'identifiant manquant' }, 400);
  const store = getStore({ name: 'myicar', consistency: 'strong' });
  const res = await store.get(`cote/${id}`, { type: 'json' });
  if (!res) return json({ pret: false });
  try { await store.delete(`cote/${id}`); } catch {}
  return json({ pret: true, ...res }, res.erreur ? 502 : 200);
};

export const config = { path: '/api/cote' };
