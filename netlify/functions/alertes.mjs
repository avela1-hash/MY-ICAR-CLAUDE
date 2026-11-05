// My I-Car — s'abonner / se désabonner des alertes sur ce téléphone, et alerte d'essai.
import { verifier, json } from '../lib/acces.mjs';
import { clesVapid, abonnes, ecrireAbonnes, envoyer } from '../lib/alertes.mjs';

export default async (req) => {
  const qui = await verifier(req);
  if (qui instanceof Response) return qui;

  if (req.method === 'GET') {
    const k = await clesVapid();
    return json({ cle: k.publicKey });
  }

  let corps = {};
  try { corps = await req.json(); } catch {}
  const sub = corps.sub;
  const liste = await abonnes();

  if (req.method === 'POST' && corps.essai) {
    const r = await envoyer({ titre: 'My I-Car', texte: 'Les alertes marchent sur ce téléphone 👍', page: 'dashboard', tag: 'essai' }, { nom: qui.nom });
    return json(r);
  }

  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return json({ erreur: 'abonnement invalide' }, 400);

  if (req.method === 'POST') {
    const autres = liste.filter(a => a.sub.endpoint !== sub.endpoint);
    autres.push({ nom: qui.nom, sub, depuis: new Date().toISOString() });
    await ecrireAbonnes(autres.slice(-40));
    return json({ ok: true });
  }
  if (req.method === 'DELETE') {
    await ecrireAbonnes(liste.filter(a => a.sub.endpoint !== sub.endpoint));
    return json({ ok: true });
  }
  return json({ erreur: 'méthode non autorisée' }, 405);
};

export const config = { path: '/api/alertes' };
