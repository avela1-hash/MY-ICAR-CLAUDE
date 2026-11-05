// My I-Car — recherche de la cote occasion (Gemini + recherche Google intégrée).
// Ce n'est PAS la cote Argus officielle : une estimation à partir des prix affichés.
import { env } from './acces.mjs';
const nombre = (v) => {
  const n = Math.round(Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function lire(texte) {
  const propre = String(texte || '').replace(/```(?:json)?/gi, '');
  const m = propre.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}


export async function chercherCote(v, budgetMs = 60000) {
  const key = env('GEMINI_API_KEY');
  if (!key) return { erreur: 'clé Gemini absente sur Netlify (GEMINI_API_KEY)' };
  const modele = String(v.modele || '').slice(0, 120).trim();
  if (!modele) return { erreur: 'Indique au moins le modèle du véhicule.' };
  const annee = String(v.annee || '').slice(0, 10).trim();
  const km = nombre(v.km);
  const finition = String(v.finition || '').slice(0, 120).trim();
  const voiture = [modele, finition, annee && `de ${annee}`, km && `${km.toLocaleString('fr-FR')} km`].filter(Boolean).join(', ');
  const prompt = `Estime la cote de revente en France, sur le marché de l'occasion, de ce véhicule en bon état : ${voiture}.
Cherche les prix affichés actuellement sur les sites les plus connus : La Centrale, Leboncoin, AutoScout24, Aramisauto, L'argus.
Compare des véhicules proches (même modèle, années et kilométrages voisins).
Réponds UNIQUEMENT avec ce JSON, sans autre texte :
{"basse": nombre en euros, "haute": nombre en euros, "moyenne": nombre en euros, "fiabilite": "bonne" | "moyenne" | "faible", "explication": "une phrase courte en français, sans jargon"}`;
  const modeles = [...new Set([env('GEMINI_MODEL_COTE'), 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'].filter(Boolean))];
  const fin = Date.now() + budgetMs;
  let derniere = '';
  for (const m of modeles) {
    const reste = fin - Date.now();
    if (reste < 3000) break;
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', signal: AbortSignal.timeout(Math.min(reste, 40000)),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
        })
      });
    } catch (e) { derniere = 'recherche trop longue'; continue; }
    if (!r.ok) { derniere = `Gemini a répondu ${r.status}`; continue; }
    const data = await r.json();
    const cand = data?.candidates?.[0] || {};
    const texte = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    const res = lire(texte);
    const basse = nombre(res?.basse), haute = nombre(res?.haute);
    let moyenne = nombre(res?.moyenne);
    if (!basse && !haute && !moyenne) { derniere = 'pas de prix trouvé'; continue; }
    if (!moyenne) moyenne = Math.round(((basse || haute) + (haute || basse)) / 2);
    const vus = new Set();
    const sources = (cand.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web).filter((w) => w?.uri)
      .filter((w) => { const k = w.title || w.uri; if (vus.has(k)) return false; vus.add(k); return true; })
      .slice(0, 5).map((w) => ({ titre: String(w.title || 'Source').slice(0, 80), url: w.uri }));
    return {
      basse, haute, moyenne,
      fiabilite: ['bonne', 'moyenne', 'faible'].includes(res?.fiabilite) ? res.fiabilite : 'moyenne',
      explication: String(res?.explication || '').slice(0, 300),
      sources, date: new Date().toISOString().slice(0, 10), voiture
    };
  }
  return { erreur: `Cote introuvable pour l’instant (${derniere || 'pas de réponse'}). Réessaie.` };
}
