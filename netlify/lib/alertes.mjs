// My I-Car — alertes sur le téléphone (notifications Web Push).
// Les clés VAPID sont créées toutes seules au premier usage et rangées dans la base :
// rien à régler sur Netlify.
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

const magasin = () => getStore({ name: 'myicar', consistency: 'strong' });

export async function clesVapid() {
  const s = magasin();
  let k = await s.get('vapid', { type: 'json' });
  if (!k || !k.publicKey || !k.privateKey) {
    k = webpush.generateVAPIDKeys();
    await s.setJSON('vapid', k);
  }
  return k;
}

export async function abonnes() {
  return (await magasin().get('abonnes', { type: 'json' })) || [];
}
export async function ecrireAbonnes(l) {
  await magasin().setJSON('abonnes', l);
}

// Envoie à tous les téléphones abonnés (ou à ceux d'une personne). Retire les abonnements morts.
export async function envoyer(message, { nom } = {}) {
  const k = await clesVapid();
  webpush.setVapidDetails('mailto:contact@myicar.invalid', k.publicKey, k.privateKey);
  const liste = await abonnes();
  const cibles = liste.filter(a => !nom || a.nom === nom);
  let ok = 0, morts = [];
  await Promise.all(cibles.map(async a => {
    try {
      await webpush.sendNotification(a.sub, JSON.stringify(message), { TTL: 6 * 3600, urgency: 'high' });
      ok++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) morts.push(a.sub.endpoint);
    }
  }));
  if (morts.length) await ecrireAbonnes(liste.filter(a => !morts.includes(a.sub.endpoint)));
  return { envoyes: ok, cibles: cibles.length };
}
