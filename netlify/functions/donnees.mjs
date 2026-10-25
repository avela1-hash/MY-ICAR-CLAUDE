// My I-Car — base de données partagée de l'équipe (Netlify Blobs, gratuit).
// Toute l'équipe lit et écrit le même dossier, protégé par le code d'équipe
// (variable secrète CODE_EQUIPE à créer sur Netlify).
import { getStore } from '@netlify/blobs';
import { verifier, json } from '../lib/acces.mjs';

const CLE = 'atelier';
const TAILLE_MAX = 4_000_000;


export default async (req) => {
  const qui = await verifier(req);
  if (qui instanceof Response) return qui;

  const store = getStore({ name: 'myicar', consistency: 'strong' });

  if (req.method === 'GET') {
    const brut = await store.get(CLE, { type: 'json' });
    return json({ ...(brut || { version: 0, data: null }), role: qui.role, nom: qui.nom });
  }

  if (req.method === 'PUT') {
    const texte = await req.text();
    if (texte.length > TAILLE_MAX) return json({ erreur: 'données trop volumineuses' }, 413);
    let corps;
    try { corps = JSON.parse(texte); } catch { return json({ erreur: 'données illisibles' }, 400); }
    if (!corps || typeof corps.data !== 'object' || Array.isArray(corps.data)) return json({ erreur: 'données invalides' }, 400);
    const actuel = (await store.get(CLE, { type: 'json' })) || { version: 0, data: null };
    // Quelqu'un a enregistré entre-temps : on renvoie sa version, l'appli fusionne et réessaie.
    if (Number(corps.version) !== Number(actuel.version)) return json({ conflit: true, ...actuel }, 409);
    const suivant = { version: Number(actuel.version) + 1, maj: new Date().toISOString(), data: corps.data };
    await store.setJSON(CLE, suivant);
    // Copie de secours quotidienne (garde un historique en cas de fausse manœuvre).
    await store.setJSON('sauvegarde-' + suivant.maj.slice(0, 10), suivant).catch(() => {});
    return json({ version: suivant.version, maj: suivant.maj });
  }

  return json({ erreur: 'méthode non autorisée' }, 405);
};

export const config = { path: '/api/donnees' };
