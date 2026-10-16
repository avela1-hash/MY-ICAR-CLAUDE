// My I-Car V9 — fonction serveur du PILOTE GLOBAL.
// Aurel parle (ou écrit) n'importe quelle demande ; Gemini lit l'état de l'appli
// et renvoie une réponse à lire à voix haute + une liste d'actions à appliquer
// (naviguer, ajouter, modifier, supprimer, lancer l'entretien de dossier).
// La clé GEMINI_API_KEY reste secrète côté Netlify.

const SECTIONS = {
  vehicules: {
    nom: 'Dossiers atelier (véhicules en réparation)',
    champs: {
      client: 'texte', modele: 'texte (marque et modèle)', immatriculation: 'texte AA-123-AA',
      statut: ['À chiffrer', 'En attente', 'À planifier', 'En travaux', 'Peinture', 'Prêt à livrer', 'Livré'],
      priorite: 'entier 1 à 10', montant: 'nombre en euros', notes: 'texte'
    }
  },
  planning: {
    nom: 'Planning (rendez-vous et interventions)',
    champs: {
      date: 'AAAA-MM-JJ', heure: 'HH:MM', titre: 'texte',
      responsable: ['Enzo', 'IB', 'Brahim', 'Aurel', 'Autre'],
      statut: ['Prévu', 'En cours', 'Terminé'], notes: 'texte'
    }
  },
  prets: {
    nom: 'Voitures de prêt',
    champs: {
      nom: 'texte (la voiture de prêt)', client: 'texte', date_depart: 'AAAA-MM-JJ', date_retour: 'AAAA-MM-JJ',
      statut: ['Disponible', 'Réservé', 'Prêté', 'Retourné'], notes: 'texte (mets-y l\'heure de départ/retour si elle est dite)'
    }
  },
  taches: {
    nom: 'Relances et tâches',
    champs: {
      titre: 'texte', client: 'texte', echeance: 'AAAA-MM-JJ',
      responsable: ['Enzo', 'IB', 'Brahim', 'Aurel', 'Autre'],
      statut: ['À faire', 'En cours', 'Terminée'], notes: 'texte'
    }
  },
  clients: {
    nom: 'Clients',
    champs: { nom: 'texte', telephone: 'texte', email: 'texte', vehicule: 'texte', notes: 'texte' }
  },
  expertises: {
    nom: 'Expertises',
    champs: {
      client: 'texte', immatriculation: 'texte', date: 'AAAA-MM-JJ',
      statut: ['Sans RDV', 'RDV fixé', 'Réalisée', 'À relancer'], notes: 'texte'
    }
  }
};
const PAGES = ['dashboard', 'vehicules', 'planning', 'prets', 'taches', 'clients', 'expertises', 'assistant', 'aide', 'parametres'];

const descriptionSchema = Object.entries(SECTIONS).map(([cle, s]) =>
  `- ${cle} (${s.nom}) : ` + Object.entries(s.champs)
    .map(([c, t]) => `${c} = ${Array.isArray(t) ? 'exactement un de ' + JSON.stringify(t) : t}`).join(' ; ')
).join('\n');

const SYSTEME = `Tu es « le pilote » de My I-Car, l'application d'un atelier de carrosserie.
Tu parles avec Aurel, le patron, à voix haute. Tu le tutoies. Tu pilotes TOUTE l'application à sa place.

Sections de données et leurs champs :
${descriptionSchema}

Pages de l'appli : dashboard (le cockpit), vehicules (dossiers), planning, prets, taches (relances), clients, expertises, assistant (entretien guidé pour créer un dossier), aide, parametres (sauvegardes).

Tu reçois : la date et l'heure, la page affichée, toutes les données (chaque élément a un « id »), la conversation récente et la dernière phrase d'Aurel.

Tu réponds UNIQUEMENT avec ce JSON :
{"reponse": "ce que tu dis à Aurel", "actions": [ ... ], "confirmation": false}

Actions possibles :
- {"type":"aller","page":"prets","recherche":"texte facultatif","statut":"statut facultatif"} → afficher une page, éventuellement filtrée
- {"type":"ajouter","section":"prets","valeurs":{...}}
- {"type":"modifier","section":"vehicules","id":"id exact","valeurs":{seulement les champs qui changent}}
- {"type":"supprimer","section":"taches","id":"id exact"}
- {"type":"entretien"} → lance l'entretien guidé de création de dossier (seulement si Aurel le demande ou dit qu'il veut « raconter » un nouveau dossier sans donner d'infos)

Règles :
1. « reponse » est lue par une voix de synthèse : 1 à 3 phrases courtes, naturelles, sans symboles, sans liste à puces, sans emoji. Pour une liste, cite au maximum 5 éléments puis dis combien il en reste.
2. Pour répondre à une question, utilise UNIQUEMENT les données fournies. N'invente jamais rien. Si l'info n'existe pas, dis-le.
3. Tu peux enchaîner plusieurs actions pour une seule demande (ex. : ajouter un prêt ET afficher la page des prêts ; créer un dossier ET une relance).
4. Pour modifier ou supprimer, utilise l'id exact d'un élément existant. Si plusieurs éléments correspondent, ou aucun, ne fais aucune action et pose une question courte pour préciser.
5. Toute suppression : mets "confirmation": true et demande à Aurel de confirmer dans « reponse » (ex. « Je supprime la relance Dupont, tu confirmes ? »). Ne mets jamais confirmation à true pour autre chose.
6. Dates au format AAAA-MM-JJ calculées à partir de la date du jour (« demain », « jeudi », « dans une semaine »). Heures au format HH:MM. Pour les champs à liste, utilise exactement une des valeurs proposées.
7. Quand une voiture de prêt part chez un client, mets son statut à « Prêté » ; quand elle revient, « Retourné ». Garde l'heure de départ dite par Aurel dans les notes du prêt, c'est important pour désigner le conducteur en cas d'amende.
8. Si la demande est floue, pose UNE question courte sans faire d'action.
9. La transcription vient d'un micro : ignore le bruit sans rapport (télé, autre personne). Si la phrase n'a aucun sens pour l'atelier, demande-lui de répéter.
10. Après une action, confirme brièvement ce que tu as fait (ex. « C'est noté, la Clio est prêtée à Monsieur Martin jusqu'à vendredi. »).
11. Si Aurel dit merci, c'est tout, ou au revoir, réponds brièvement sans action.`;

const env = (k) => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const court = (v, n) => String(v ?? '').slice(0, n);

// Ne garde que les champs connus, des textes courts : protège le quota et la qualité.
function donneesCompactes(brut) {
  const out = {};
  for (const [section, def] of Object.entries(SECTIONS)) {
    const liste = Array.isArray(brut?.[section]) ? brut[section] : [];
    out[section] = liste.slice(0, 300).map(el => {
      const r = { id: court(el?.id, 60) };
      for (const champ of Object.keys(def.champs)) {
        const v = el?.[champ];
        if (v !== undefined && v !== null && String(v).trim()) r[champ] = court(v, champ === 'notes' ? 240 : 120);
      }
      return r;
    });
  }
  return out;
}

function nettoieValeurs(section, valeurs) {
  const def = SECTIONS[section]?.champs || {};
  const propres = {};
  for (const [k, v] of Object.entries(valeurs || {})) {
    if (!(k in def) || v === null || v === undefined) continue;
    let s = String(v).trim().slice(0, 600);
    if (Array.isArray(def[k]) && s && !def[k].includes(s)) continue; // valeur hors liste → ignorée
    propres[k] = s;
  }
  return propres;
}

function nettoieActions(actions) {
  const out = [];
  for (const a of (Array.isArray(actions) ? actions : []).slice(0, 12)) {
    const type = a?.type;
    if (type === 'aller' && PAGES.includes(a.page)) {
      out.push({ type, page: a.page, recherche: court(a.recherche, 80), statut: court(a.statut, 40) });
    } else if (type === 'ajouter' && SECTIONS[a.section]) {
      const valeurs = nettoieValeurs(a.section, a.valeurs);
      if (Object.keys(valeurs).length) out.push({ type, section: a.section, valeurs });
    } else if (type === 'modifier' && SECTIONS[a.section] && a.id) {
      const valeurs = nettoieValeurs(a.section, a.valeurs);
      if (Object.keys(valeurs).length) out.push({ type, section: a.section, id: court(a.id, 60), valeurs });
    } else if (type === 'supprimer' && SECTIONS[a.section] && a.id) {
      out.push({ type, section: a.section, id: court(a.id, 60) });
    } else if (type === 'entretien') {
      out.push({ type });
    }
  }
  return out;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ erreur: 'Méthode non autorisée' }, 405);

  // Refuse les appels venant d'un autre site (protège ton quota gratuit).
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(req.url).host) return json({ erreur: 'Origine refusée' }, 403);
    } catch { return json({ erreur: 'Origine refusée' }, 403); }
  }

  const key = env('GEMINI_API_KEY');
  if (!key) return json({ erreur: 'clé GEMINI_API_KEY absente dans Netlify' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ erreur: 'requête illisible' }, 400); }

  const phrase = court(body.phrase, 1500).trim();
  if (!phrase) return json({ erreur: 'phrase vide' }, 400);

  const historique = (Array.isArray(body.historique) ? body.historique : [])
    .slice(-16)
    .map(m => `${m?.qui === 'aurel' ? 'Aurel' : 'Pilote'} : ${court(m?.texte, 600)}`)
    .join('\n');

  const prompt = `Date et heure : ${court(body.maintenant, 40) || new Date().toISOString()}
Page affichée : ${PAGES.includes(body.page) ? body.page : 'dashboard'}

Données de l'appli :
${JSON.stringify(donneesCompactes(body.donnees))}

Conversation récente :
${historique || '(début de conversation)'}

Aurel vient de dire : « ${phrase} »`;

  const modeles = [env('GEMINI_MODEL'), 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean);
  let reponse, dernierStatut = 0;
  for (const modele of modeles) {
    const generationConfig = { temperature: 0.2, responseMimeType: 'application/json' };
    if (modele.startsWith('gemini-2.5')) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    reponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEME }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig
      })
    });
    dernierStatut = reponse.status;
    if (reponse.status !== 404 && reponse.status !== 400) break; // modèle introuvable → on essaie le suivant
  }

  if (!reponse.ok) {
    const detail = (await reponse.text()).slice(0, 300);
    const message = dernierStatut === 429 ? 'quota gratuit Gemini atteint, réessaie dans une minute'
      : (dernierStatut === 403 || /API key/i.test(detail)) ? 'clé Gemini refusée, vérifie GEMINI_API_KEY'
      : `Gemini a répondu ${dernierStatut}`;
    return json({ erreur: message, detail }, 502);
  }

  const data = await reponse.json();
  const texte = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  let out;
  try { out = JSON.parse(texte); } catch { return json({ erreur: 'réponse de l’IA illisible' }, 502); }

  const actions = nettoieActions(out.actions);
  return json({
    reponse: court(out.reponse, 700) || 'Je n’ai pas compris, tu peux répéter ?',
    actions,
    confirmation: out.confirmation === true && actions.some(a => a.type === 'supprimer')
  });
};

export const config = { path: '/api/pilote-global' };
