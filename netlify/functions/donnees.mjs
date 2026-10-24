// My I-Car — base de données partagée de l'équipe (Netlify Blobs, gratuit).
// Toute l'équipe lit et écrit le même dossier, protégé par le code d'équipe
// (variable secrète CODE_EQUIPE à créer sur Netlify).
import { getStore } from '@netlify/blobs';

const env = (k) => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const CLE = 'atelier';
const TAILLE_MAX = 4_000_000;

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

  const store = getStore({ name: 'myicar', consistency: 'strong' });

  if (req.method === 'GET') {
    const brut = await store.get(CLE, { type: 'json' });
    return json(brut || { version: 0, data: null });
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
