// My I-Car — lecture de la CARTE GRISE en photo (Gemini).
// Le téléphone envoie la photo (réduite), Gemini lit les cases et renvoie les infos du véhicule.
// La photo n'est pas gardée : elle sert à cette lecture puis disparaît.
import { verifier, json, env } from '../lib/acces.mjs';

const PROMPT = `Voici la photo d'un certificat d'immatriculation français (carte grise).
Lis les cases et réponds UNIQUEMENT avec ce JSON (chaîne vide si illisible) :
{"immatriculation":"A","date_mec":"B au format JJ/MM/AAAA","marque":"D.1","modele":"D.3 (dénomination commerciale)","version":"D.2","vin":"E (17 caractères)","titulaire":"C.1 (nom et prénom)","energie":"P.3","puissance_fiscale":"P.6","couleur":"couleur si indiquée","places":"S.1"}`;

export default async (req) => {
  if (req.method !== 'POST') return json({ erreur: 'méthode non prise en charge' }, 405);
  const qui = await verifier(req);
  if (qui instanceof Response) return qui;
  const key = env('GEMINI_API_KEY');
  if (!key) return json({ erreur: 'clé Gemini absente sur Netlify (GEMINI_API_KEY)' }, 503);
  let corps = {}; try { corps = await req.json(); } catch {}
  const m = String(corps.image || '').match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m || m[2].length > 6_000_000) return json({ erreur: 'photo illisible, reprends-la' }, 400);

  const fin = Date.now() + 9000;
  let derniere = '';
  for (const modele of ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest']) {
    const reste = fin - Date.now();
    if (reste < 1500) break;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(reste),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inline_data: { mime_type: m[1], data: m[2] } }, { text: PROMPT }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 600, ...(/2\.5/.test(modele) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) }
        })
      });
      if (!r.ok) { derniere = `Gemini a répondu ${r.status}`; continue; }
      const data = await r.json();
      const texte = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const t = texte.replace(/```(?:json)?/g, '');
      const res = JSON.parse((t.match(/\{[\s\S]*\}/) || ['{}'])[0]);
      const propre = {};
      for (const k of ['immatriculation', 'date_mec', 'marque', 'modele', 'version', 'vin', 'titulaire', 'energie', 'puissance_fiscale', 'couleur', 'places'])
        propre[k] = String(res[k] || '').trim().slice(0, 120);
      if (!propre.immatriculation && !propre.vin && !propre.marque) { derniere = 'carte grise non reconnue'; continue; }
      return json(propre);
    } catch (e) { derniere = 'lecture trop longue'; }
  }
  return json({ erreur: `Je n’arrive pas à lire la carte grise (${derniere}). Reprends la photo bien à plat, sans reflet.` }, 502);
};

export const config = { path: '/api/carte-grise' };
