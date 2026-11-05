// My I-Car — COTE DU VÉHICULE (marché de l'occasion).
// Gemini cherche sur le web (recherche Google intégrée) les annonces et cotes publiques
// des sites les plus connus (La Centrale, Leboncoin, AutoScout24, Aramisauto, L'argus)
// et renvoie une fourchette de prix + les liens consultés.
// Ce n'est PAS une cote officielle Argus (payante, sans accès libre) : c'est une estimation
// à partir des prix affichés. Les liens sont donnés pour vérifier.
import { verifier, json, env } from '../lib/acces.mjs';

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

export default async (req) => {
  if (req.method !== 'POST') return json({ erreur: 'méthode non prise en charge' }, 405);
  const qui = await verifier(req);
  if (qui instanceof Response) return qui;
  const key = env('GEMINI_API_KEY');
  if (!key) return json({ erreur: 'clé Gemini absente sur Netlify (GEMINI_API_KEY)' }, 503);

  let v = {};
  try { v = await req.json(); } catch {}
  const modele = String(v.modele || '').slice(0, 120).trim();
  if (!modele) return json({ erreur: 'Indique au moins le modèle du véhicule.' }, 400);
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
  const fin = Date.now() + 9000; // Netlify coupe à 10 s
  let derniere = '';
  for (const m of modeles) {
    const reste = fin - Date.now();
    if (reste < 1500) break;
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(reste),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 800, ...(/2\.5/.test(m) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) }
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
    return json({
      basse, haute, moyenne,
      fiabilite: ['bonne', 'moyenne', 'faible'].includes(res?.fiabilite) ? res.fiabilite : 'moyenne',
      explication: String(res?.explication || '').slice(0, 300),
      sources, date: new Date().toISOString().slice(0, 10), voiture
    });
  }
  return json({ erreur: `Cote introuvable pour l’instant (${derniere || 'pas de réponse'}). Réessaie.` }, 502);
};

export const config = { path: '/api/cote' };
