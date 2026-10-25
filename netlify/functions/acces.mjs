// My I-Car — gestion des accès de l'équipe (réservée au code du patron).
import { verifier, listeAcces, ecrireAcces, json } from '../lib/acces.mjs';

function nouveauCode(pris) {
  for (;;) {
    const c = String(100000 + Math.floor(Math.random() * 900000));
    if (!pris.has(c)) return c;
  }
}

export default async (req) => {
  const qui = await verifier(req);
  if (qui instanceof Response) return qui;
  if (qui.role !== 'admin') return json({ erreur: 'réservé au patron' }, 403);

  let liste = await listeAcces();
  if (req.method === 'GET') return json({ liste });
  if (req.method !== 'POST') return json({ erreur: 'méthode non autorisée' }, 405);

  let corps;
  try { corps = await req.json(); } catch { return json({ erreur: 'demande illisible' }, 400); }
  const { action, id } = corps || {};

  if (action === 'ajouter') {
    const nom = String(corps.nom || '').trim().slice(0, 40);
    if (!nom) return json({ erreur: 'prénom manquant' }, 400);
    const code = nouveauCode(new Set(liste.map(p => p.code)));
    liste.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nom, code, actif: true, cree: new Date().toISOString() });
  } else if (action === 'basculer') {
    const p = liste.find(x => x.id === id);
    if (!p) return json({ erreur: 'personne introuvable' }, 404);
    p.actif = !p.actif;
  } else if (action === 'nouveau-code') {
    const p = liste.find(x => x.id === id);
    if (!p) return json({ erreur: 'personne introuvable' }, 404);
    p.code = nouveauCode(new Set(liste.map(q => q.code)));
  } else if (action === 'supprimer') {
    liste = liste.filter(x => x.id !== id);
  } else {
    return json({ erreur: 'action inconnue' }, 400);
  }
  await ecrireAcces(liste);
  return json({ liste });
};

export const config = { path: '/api/acces' };
