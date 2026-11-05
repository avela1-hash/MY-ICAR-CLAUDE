// My I-Car — les agents : tournent tout seuls toutes les 15 minutes, sans que personne n'ouvre l'appli.
//  1. Prêt en retard : alerte dès qu'une voiture n'est pas rentrée à l'heure (puis un rappel par jour).
//  2. Retour à risque : la voiture du client n'est pas finie et le prêt doit revenir dans les 2 jours.
//  3. Échéances de la flotte : contrôle technique et assurance à 30 j, 7 j, et le jour où c'est dépassé.
// Envoi uniquement de 7 h à 21 h (heure de Paris) ; la nuit, ça attend le matin.
import { getStore } from '@netlify/blobs';
import { listeAcces } from '../lib/acces.mjs';
import { abonnes, ecrireAbonnes, envoyer } from '../lib/alertes.mjs';

const DOSSIER_FINI = ['Prêt à livrer', 'Livré'];

// « YYYY-MM-DDTHH:MM » à l'heure de Paris
function maintenantParis(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const plusJours = (iso, n) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const frDate = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
const dh = (d, h) => frDate(d) + (h ? ' à ' + h.replace(':', ' h ') : '');

// « 12/03/2027 » ou « 12.03.27 » → nombre de jours d'ici là (null si pas de date)
function joursAvant(v, aujourdhui) {
  const m = String(v || '').match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!m) return null;
  let a = +m[3]; if (a < 100) a += 2000;
  const cible = Date.UTC(a, +m[2] - 1, +m[1]), auj = Date.parse(aujourdhui + 'T00:00:00Z');
  if (isNaN(cible)) return null;
  return Math.round((cible - auj) / 864e5);
}

export function calculerAlertes(data, maint) {
  const auj = maint.slice(0, 10), out = [];
  const prets = Array.isArray(data?.prets) ? data.prets : [];
  const dossiers = Array.isArray(data?.vehicules) ? data.vehicules : [];
  const label = v => [v.client, v.modele, v.immatriculation].filter(Boolean).join(' · ');

  for (const p of prets.filter(x => x.statut === 'Prêté' && x.date_retour)) {
    const fin = p.date_retour + 'T' + (p.heure_retour || '23:59');
    const suivant = prets.filter(x => x.id !== p.id && x.statut === 'Réservé' && x.nom === p.nom && (x.date_depart || '') >= p.date_retour)
      .sort((a, b) => (a.date_depart + (a.heure_depart || '')).localeCompare(b.date_depart + (b.heure_depart || '')))[0];
    const apres = suivant ? ` Elle est réservée pour ${suivant.client || 'un client'} le ${dh(suivant.date_depart, suivant.heure_depart)}.` : '';
    if (fin < maint) {
      out.push({
        cle: `retard:${p.id}:${auj}`, page: 'prets', tag: 'retard-' + p.id,
        titre: `⏰ ${p.nom || 'Voiture de prêt'} pas rentrée`,
        texte: `${p.client || 'Le client'} devait la ramener le ${dh(p.date_retour, p.heure_retour)}.${p.telephone ? ' Tél. ' + p.telephone + '.' : ''}${apres}`
      });
      continue;
    }
    const d = p.dossier ? dossiers.find(v => label(v) === p.dossier) : null;
    if (d && !DOSSIER_FINI.includes(d.statut) && p.date_retour <= plusJours(auj, 2)) {
      out.push({
        cle: `risque:${p.id}:${p.date_retour}`, page: 'prets', tag: 'risque-' + p.id,
        titre: `⚠️ Retour à risque · ${p.nom || 'prêt'}`,
        texte: `${p.client || 'Le client'} doit la rendre le ${dh(p.date_retour, p.heure_retour)}, mais sa voiture est encore « ${d.statut || 'sans étape'} ».${apres}`
      });
    }
  }

  const flotte = Array.isArray(data?.garage?.flotte) ? data.garage.flotte : [];
  for (const f of flotte) {
    for (const [champ, nomEch] of [['ct', 'Contrôle technique'], ['assurance', 'Assurance']]) {
      const j = joursAvant(f[champ], auj);
      if (j === null) continue;
      const palier = j < 0 ? 'depasse' : j <= 7 ? '7j' : j <= 30 ? '30j' : null;
      if (!palier) continue;
      out.push({
        cle: `ech:${f.nom}:${champ}:${f[champ]}:${palier}`, page: 'flotte', tag: `ech-${f.nom}-${champ}`,
        titre: j < 0 ? `🔴 ${nomEch} dépassé · ${f.nom}` : `📅 ${nomEch} · ${f.nom}`,
        texte: j < 0 ? `Dépassé depuis le ${f[champ]}. À régler avant de la reprêter.` : `À faire avant le ${f[champ]} (dans ${j} jour${j > 1 ? 's' : ''}).`
      });
    }
  }
  return out;
}

export default async () => {
  const maint = maintenantParis(), heure = +maint.slice(11, 13);
  if (heure < 7 || heure >= 21) return new Response('nuit');

  const store = getStore({ name: 'myicar', consistency: 'strong' });
  const [base, etatBrut, liste, acces] = await Promise.all([
    store.get('atelier', { type: 'json' }), store.get('agents-etat', { type: 'json' }), abonnes(), listeAcces()
  ]);
  if (!base?.data || !liste.length) return new Response('rien');

  // Un code coupé = plus d'alertes pour cette personne.
  const autorises = new Set(['Aurel', ...acces.filter(a => a.actif).map(a => a.nom)]);
  const vivants = liste.filter(a => autorises.has(a.nom));
  if (vivants.length !== liste.length) await ecrireAbonnes(vivants);
  if (!vivants.length) return new Response('rien');

  const etat = etatBrut || { envoye: {} };
  const aEnvoyer = calculerAlertes(base.data, maint).filter(a => !etat.envoye[a.cle]);
  for (const a of aEnvoyer.slice(0, 6)) {
    await envoyer({ titre: a.titre, texte: a.texte, page: a.page, tag: a.tag });
    etat.envoye[a.cle] = maint;
  }
  // On oublie ce qui date de plus de 60 jours.
  const limite = plusJours(maint, -60);
  for (const [k, v] of Object.entries(etat.envoye)) if (v < limite) delete etat.envoye[k];
  if (aEnvoyer.length) await store.setJSON('agents-etat', etat);
  return new Response(`${aEnvoyer.length} alerte(s)`);
};

export const config = { schedule: '*/15 * * * *' };
