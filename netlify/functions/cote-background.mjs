// My I-Car — COTE en tâche de fond (Netlify laisse jusqu'à 15 min, au lieu de 10 s).
// Le téléphone lance la recherche ici avec un identifiant, puis demande le résultat à /api/cote?id=…
import { getStore } from '@netlify/blobs';
import { verifier } from '../lib/acces.mjs';
import { chercherCote } from '../lib/cote.mjs';

export default async (req) => {
  const qui = await verifier(req);
  if (qui instanceof Response) return;
  let v = {}; try { v = await req.json(); } catch {}
  const id = String(v.id || '').replace(/[^\w-]/g, '').slice(0, 60);
  if (!id) return;
  const store = getStore({ name: 'myicar', consistency: 'strong' });
  let res;
  try { res = await chercherCote(v, 90000); } catch (e) { res = { erreur: 'Cote introuvable pour l’instant. Réessaie.' }; }
  await store.setJSON(`cote/${id}`, { ...res, fini: Date.now() });
};
