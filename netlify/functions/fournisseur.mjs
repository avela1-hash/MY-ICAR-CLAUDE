// My I-Car — page fournisseur (Julien, Didier, les marques).
// Le garage envoie au fournisseur un lien unique, qu'il garde. Il y voit SES demandes
// de pièces et répond dessous : dispo, prix, délai, trouvée en couleur ou non.
//
// Pas de code d'équipe ici : l'accès se fait par un jeton propre à ce fournisseur.
// Règle de fer : ce fichier ne renvoie JAMAIS de donnée client. Pas de nom, pas de
// téléphone, pas de photo de permis, pas de contrat. Le filtrage se fait ici, côté
// serveur, avant l'envoi — pas à l'écran, sinon ce serait un décor.
import { getStore } from '@netlify/blobs';
import { json, egal } from '../lib/acces.mjs';

const CLE = 'atelier';
const TEXTE_MAX = 4_000;

const listeFournisseurs = (brut) => brut?.data?.garage?.fournisseurs || [];
const listeDemandes = (brut) => (Array.isArray(brut?.data?.demandes) ? brut.data.demandes : []);

function identifie(brut, f, j) {
  if (!f || !j) return null;
  const four = listeFournisseurs(brut).find((x) => x && x.id === f && x.actif !== false);
  if (!four || !four.jeton || !egal(four.jeton, j)) return null;
  return four;
}

// Ce que le fournisseur a le droit de voir : la voiture et la pièce. Rien d'autre.
function pourFournisseur(d) {
  return {
    id: d.id,
    vehicule: d.vehicule || '',
    annee: d.annee || '',
    vin: d.vin || '',
    immat: d.immat || '',
    couleur: d.couleur || '',
    code_peinture: d.code_peinture || '',
    piece: d.piece || '',
    reemploi: !!d.reemploi,
    note: d.note || '',
    statut: d.statut || 'Envoyée',
    envoye_le: d.envoye_le || '',
    reponse: d.reponse || null,
  };
}

export default async (req) => {
  const store = getStore({ name: 'myicar', consistency: 'strong' });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const f = url.searchParams.get('f') || '';
    const j = url.searchParams.get('j') || '';
    const brut = await store.get(CLE, { type: 'json' });
    const four = identifie(brut, f, j);
    if (!four) return json({ erreur: 'Ce lien n’est plus valable. Demandez-en un nouveau au garage.' }, 404);

    const id = brut.data.garage?.identite || {};
    const miennes = listeDemandes(brut)
      .filter((d) => d && d.fournisseur === four.id)
      .sort((a, b) => String(b.envoye_le || '').localeCompare(String(a.envoye_le || '')))
      .map(pourFournisseur);

    return json({
      fournisseur: { nom: four.nom || '' },
      garage: { raison: id.raison || 'Le garage', tel: id.tel || '', adresse: id.adresse || '' },
      demandes: miennes,
    });
  }

  if (req.method === 'POST') {
    const texte = await req.text();
    if (texte.length > TEXTE_MAX) return json({ erreur: 'réponse trop longue' }, 413);
    let c;
    try { c = JSON.parse(texte); } catch { return json({ erreur: 'réponse illisible' }, 400); }

    const f = String(c?.f || ''), j = String(c?.j || ''), dId = String(c?.d || '');
    const brut = await store.get(CLE, { type: 'json' });
    const four = identifie(brut, f, j);
    if (!four) return json({ erreur: 'Ce lien n’est plus valable.' }, 404);

    const d = listeDemandes(brut).find((x) => x && x.id === dId && x.fournisseur === four.id);
    if (!d) return json({ erreur: 'Cette demande n’existe plus.' }, 404);

    const r = c?.reponse || {};
    const maint = new Date().toISOString();
    d.reponse = {
      dispo: String(r.dispo || '').slice(0, 20),
      prix: String(r.prix || '').slice(0, 40),
      delai: String(r.delai || '').slice(0, 80),
      couleur_ok: !!r.couleur_ok,
      note: String(r.note || '').slice(0, 600),
      le: maint,
      par: four.nom || '',
    };
    d.statut = d.reponse.dispo === 'non' ? 'Sans suite' : 'Répondu';
    d.maj = maint;

    const suivant = { version: Number(brut.version || 0) + 1, maj: maint, data: brut.data };
    await store.setJSON(CLE, suivant);
    return json({ ok: true, demande: pourFournisseur(d) });
  }

  return json({ erreur: 'méthode non autorisée' }, 405);
};

export const config = { path: '/api/fournisseur' };
