// My I-Car V8 — fonction serveur du pilote IA.
// Elle reçoit la conversation depuis l'appli, interroge Gemini avec la clé
// GEMINI_API_KEY (variable secrète Netlify) et renvoie les champs du dossier.

const SYSTEME = `Tu es « le pilote » de My I-Car, l'assistant d'un atelier de carrosserie.
Tu aides Aurel, le patron, à constituer un dossier véhicule en conversation orale. Tu le tutoies.

Champs du dossier :
- client : nom du client tel qu'il est dit (garde « Monsieur » / « Madame » si présent)
- modele : marque et modèle du véhicule
- immatriculation : format AA-123-AA pour une plaque française
- nature : « Grêle », « Collision », « Stationnement », « Vandalisme », « Bris de glace », sinon un texte très court
- description : les dégâts constatés, en une phrase courte
- telephone : numéro du client
- assurance : compagnie d'assurance du client
- expertise : exactement « Réalisée », « À planifier » ou « Non nécessaire »
- dateRDV : date du rendez-vous au format AAAA-MM-JJ, calculée à partir de la date du jour (« demain », « mardi prochain »…)
- priorite : un entier de 1 à 10, écrit en chiffres
- prochaineAction : la prochaine action à faire, en une phrase courte

Règles :
1. Extrais tout ce qu'Aurel donne, même plusieurs informations dans une seule phrase. N'invente jamais rien.
2. Si Aurel corrige une information, renvoie la nouvelle valeur.
3. Si Aurel dit « passe », « je sais pas », « non » ou équivalent pour un champ, mets ce champ dans « passes ».
4. La transcription vient d'un micro : elle peut contenir du bruit sans rapport (télévision, autre personne, match de foot). Ignore tout ce qui ne concerne pas le dossier.
5. Pose UNE seule question, courte et naturelle à l'oral (elle sera lue par une voix de synthèse), sur l'information manquante la plus utile. Tu peux regrouper deux petites infos facultatives.
   Ordre conseillé : client ou véhicule, nature du sinistre, dégâts, expertise, priorité, puis immatriculation, téléphone, assurance, date de rendez-vous, prochaine action.
6. Ne redemande jamais un champ déjà rempli ou déjà passé. Ne fixe jamais la priorité toi-même.
7. Mets « termine » à true quand tous les champs sont remplis ou passés, ou quand Aurel dit que c'est tout.
8. En phase « review », Aurel corrige le récapitulatif : applique la correction et mets « termine » à true.

Réponds UNIQUEMENT avec ce JSON :
{"valeurs": {seulement les champs nouveaux ou corrigés}, "passes": ["champ", ...], "question": "ta question", "termine": false}`;

const CHAMPS = ['client', 'modele', 'immatriculation', 'nature', 'description', 'telephone', 'assurance', 'expertise', 'dateRDV', 'priorite', 'prochaineAction'];

const env = (k) => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

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

  const historique = (Array.isArray(body.historique) ? body.historique : [])
    .slice(-30)
    .map(m => `${m?.qui === 'aurel' ? 'Aurel' : 'Pilote'} : ${String(m?.texte ?? '').slice(0, 2000)}`)
    .join('\n');
  const valeurs = {};
  for (const k of CHAMPS) if (body.valeurs?.[k]) valeurs[k] = String(body.valeurs[k]).slice(0, 500);
  const passes = (Array.isArray(body.passes) ? body.passes : []).filter(k => CHAMPS.includes(k));

  const prompt = `Date du jour : ${String(body.aujourdhui || new Date().toISOString().slice(0, 10)).slice(0, 10)}
Phase : ${body.phase === 'review' ? 'review' : 'questions'}
Dossier actuel : ${JSON.stringify(valeurs)}
Champs passés : ${JSON.stringify(passes)}

Conversation :
${historique}`;

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

  const propres = {};
  for (const [k, v] of Object.entries(out.valeurs || {})) {
    if (CHAMPS.includes(k) && v !== null && String(v).trim()) propres[k] = String(v).trim().slice(0, 500);
  }
  return json({
    valeurs: propres,
    passes: (Array.isArray(out.passes) ? out.passes : []).filter(k => CHAMPS.includes(k)),
    question: String(out.question || '').slice(0, 400),
    termine: out.termine === true
  });
};

export const config = { path: '/api/pilote' };
