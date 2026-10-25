// My I-Car — signature à distance du contrat de prêt.
// Le garage envoie au client un lien unique (par SMS ou e-mail). Le client lit le contrat,
// peut joindre la photo de son permis, signe avec le doigt : la signature revient dans le prêt.
// Pas de code d'équipe ici : l'accès se fait par un jeton secret propre à ce prêt,
// valable 7 jours et utilisable une seule fois.
import { getStore } from '@netlify/blobs';
import { json, egal } from '../lib/acces.mjs';

const CLE = 'atelier';
const SIG_MAX = 250_000;
const PERMIS_MAX = 1_500_000;

function cherche(brut, p) {
  const prets = brut?.data?.prets;
  return Array.isArray(prets) ? prets.find(x => x && x.id === p) : null;
}
function valide(pret, j) {
  if (!pret || !pret.sign_jeton || !j || !egal(pret.sign_jeton, j)) return 'Ce lien n’est plus valable (contrat déjà signé ou lien remplacé).';
  if (pret.sign_expire && Date.parse(pret.sign_expire) < Date.now()) return 'Ce lien a expiré. Demandez au garage de vous en renvoyer un.';
  return '';
}

export default async (req) => {
  const store = getStore({ name: 'myicar', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const p = url.searchParams.get('p') || '', j = url.searchParams.get('j') || '';
    const brut = await store.get(CLE, { type: 'json' });
    const pret = cherche(brut, p);
    const err = valide(pret, j);
    if (err) return json({ erreur: err }, 404);
    const id = brut.data.garage?.identite || {};
    return json({
      garage: { raison: id.raison || 'Le garage', adresse: id.adresse || '', siret: id.siret || '', tel: id.tel || '' },
      client: pret.client || '', voiture: pret.nom || '',
      depart: [pret.date_depart || '', pret.heure_depart || ''], retour: [pret.date_retour || '', pret.heure_retour || '']
    });
  }

  if (req.method === 'POST') {
    const texte = await req.text();
    if (texte.length > SIG_MAX + PERMIS_MAX + 10_000) return json({ erreur: 'envoi trop lourd' }, 413);
    let c;
    try { c = JSON.parse(texte); } catch { return json({ erreur: 'envoi illisible' }, 400); }
    const p = String(c?.p || ''), j = String(c?.j || '');
    const signature = String(c?.signature || ''), permis = String(c?.permis || '');
    if (!/^data:image\/png;base64,/.test(signature) || signature.length > SIG_MAX) return json({ erreur: 'signature manquante' }, 400);
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(permis) || permis.length > PERMIS_MAX) return json({ erreur: 'photo du permis manquante ou illisible' }, 400);

    // Vérifie le lien avant de ranger la photo.
    const avant = await store.get(CLE, { type: 'json' });
    const err0 = valide(cherche(avant, p), j);
    if (err0) return json({ erreur: err0 }, 404);

    let photoId = '';
    if (permis) {
      photoId = crypto.randomUUID().replace(/-/g, '');
      await getStore({ name: 'myicar-photos', consistency: 'strong' }).set(photoId, permis);
    }

    const brut = await store.get(CLE, { type: 'json' });
    const pret = cherche(brut, p);
    const err = valide(pret, j);
    if (err) return json({ erreur: err }, 404);
    const maint = new Date().toISOString();
    pret.signature = signature;
    pret.signe_le = maint;
    pret.signe_distance = true;
    pret.retour_accepte = maint; // le client a coché « je m'engage à rendre le véhicule à l'heure prévue »
    pret.sign_jeton = '';
    if (photoId) { pret.permis_photo = photoId; delete pret.permis; }
    pret.maj = maint;
    const suivant = { version: Number(brut.version || 0) + 1, maj: maint, data: brut.data };
    await store.setJSON(CLE, suivant);
    return json({ ok: true });
  }

  return json({ erreur: 'méthode non autorisée' }, 405);
};

export const config = { path: '/api/signer' };
