// My I-Car — branchement commun vers l'IA, utilisé par les deux pilotes.
//
// 1. Gemini (gratuit) avec GEMINI_API_KEY.
// 2. ChatGPT seulement si Gemini n'a pas de clé, ou si IA_PRIORITE = openai.
//
// Réglages facultatifs (variables Netlify) :
//   OPENAI_MODEL  : modèle OpenAI (par défaut gpt-6-luna, rapide et ~20 fois moins cher que gpt-6-sol)
//   OPENAI_EFFORT : réflexion avant de répondre : none, low (défaut), medium
//   GEMINI_MODEL  : modèle Gemini prioritaire

const env = (k) => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];

// Netlify coupe une fonction au bout de 10 secondes et renvoie alors une page d'erreur
// (que l'appli ne sait pas lire). On se fixe donc une limite à 8,5 s pour tout l'appel,
// et chaque requête vers une IA est interrompue si elle dépasse le temps restant.
const LIMITE_MS = 8500;
let finAppel = 0;
const restant = () => Math.max(500, finAppel - Date.now());
const delai = () => AbortSignal.timeout(restant());
const tropLong = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';

export class ErreurIA extends Error {
  constructor(message, detail = '') { super(message); this.detail = detail; }
}

// ── ChatGPT (OpenAI) ────────────────────────────────────────────────────────
async function demanderOpenAI({ systeme, prompt, maxSortie }) {
  const key = env('OPENAI_API_KEY');
  // Si un modèle n'est pas accessible avec ton compte, on essaie le suivant.
  const modeles = [...new Set([env('OPENAI_MODEL'), 'gpt-6-luna', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-6-sol'].filter(Boolean))];
  let derniere = null;
  for (const modele of modeles) {
    const corps = {
      model: modele,
      messages: [
        // Les consignes fixes passent en premier : OpenAI les met en cache automatiquement (moins cher).
        { role: 'system', content: systeme },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      reasoning_effort: env('OPENAI_EFFORT') || 'low',
      // Marge pour la réflexion + la réponse ; plafonne aussi le coût d'une demande.
      max_completion_tokens: maxSortie + 1500
    };
    // Un modèle plus ancien peut refuser un réglage : on le retire et on réessaie.
    for (let essai = 0; essai < 3; essai++) {
      if (finAppel - Date.now() < 1500) throw new ErreurIA('ChatGPT trop lent à répondre');
      let r;
      try {
        r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: delai(),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(corps)
      });
      } catch (e) { throw tropLong(e) ? new ErreurIA('ChatGPT trop lent à répondre') : e; }
      if (r.ok) {
        const data = await r.json();
        const texte = String(data?.choices?.[0]?.message?.content || '').trim();
        if (!texte) { derniere = new ErreurIA('ChatGPT a renvoyé une réponse vide'); break; }
        return { texte, ia: 'ChatGPT', modele };
      }
      const brut = await r.text();
      let err = {}; try { err = JSON.parse(brut).error || {}; } catch {}
      if (r.status === 400 && err.param && err.param in corps && !['model', 'messages'].includes(err.param)) {
        delete corps[err.param]; continue; // réglage non pris en charge par ce modèle
      }
      if (r.status === 404 || err.code === 'model_not_found' || (r.status === 403 && /model/i.test(err.message || ''))) {
        derniere = new ErreurIA(`modèle ${modele} indisponible sur ton compte OpenAI`, brut.slice(0, 300)); break;
      }
      const message = r.status === 401 ? 'clé OpenAI refusée, vérifie OPENAI_API_KEY'
        : err.code === 'insufficient_quota' ? 'plus de crédit sur ton compte OpenAI'
        : r.status === 429 ? 'trop de demandes à ChatGPT, réessaie dans une minute'
        : `ChatGPT a répondu ${r.status}`;
      throw new ErreurIA(message, brut.slice(0, 300));
    }
  }
  throw derniere || new ErreurIA('aucun modèle OpenAI disponible');
}

// ── Gemini (Google) ─────────────────────────────────────────────────────────
// Google renomme régulièrement ses modèles : au lieu d'une liste figée, on demande à Google
// la liste des modèles Flash disponibles pour TA clé (une fois, puis gardée en mémoire).
let modelesDecouverts = null;
const versionDe = (nom) => parseFloat((nom.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
async function decouvrirModeles(key) {
  if (modelesDecouverts) return modelesDecouverts;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(Math.min(1200, restant()))
    });
    if (!r.ok) return [];
    const data = await r.json();
    const noms = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(n => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|audio|live|embed|thinking|exp|preview|\d{3,}$/.test(n));
    const flash = noms.filter(n => !/lite/.test(n)).sort((a, b) => versionDe(b) - versionDe(a));
    const lite = noms.filter(n => /lite/.test(n)).sort((a, b) => versionDe(b) - versionDe(a));
    // Les « lite » d'abord : beaucoup plus rapides et rarement surchargés. Le pilote doit répondre en quelques secondes.
    modelesDecouverts = [...lite.slice(0, 2), ...flash.slice(0, 2)];
    return modelesDecouverts;
  } catch { return []; }
}

// Le modèle qui vient de répondre est réessayé en premier la fois suivante.
let dernierBonModele = '';

async function demanderGemini({ systeme, prompt, maxSortie }) {
  const key = env('GEMINI_API_KEY');
  const decouverts = await decouvrirModeles(key);
  // Si le quota gratuit d'un modèle est épuisé (429) ou s'il n'existe plus (404), on passe au suivant.
  const modeles = [...new Set([env('GEMINI_MODEL'), dernierBonModele, ...decouverts, 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean))];
  let reponse, dernierStatut = 0, modeleUtilise = '', dernierDetail = '';
  for (const modele of modeles) {
    if (finAppel - Date.now() < 1000) break;
    // Réflexion réduite au minimum : le pilote doit répondre vite (Netlify coupe à 10 s).
    const reflexion = /gemini-2\./.test(modele) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' };
    for (const avecReflexion of [true, false]) {
      const generationConfig = { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: maxSortie + 800 };
      if (avecReflexion) generationConfig.thinkingConfig = reflexion;
      try {
        reponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
          // Chaque modèle a au plus 4,5 s, sauf s'il ne reste plus d'autre chance.
          method: 'POST', signal: AbortSignal.timeout(Math.min(restant(), 4500)),
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systeme }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig
          })
        });
      } catch (e) {
        if (!tropLong(e)) throw e;
        reponse = null; dernierStatut = 504; modeleUtilise = modele; break; // trop lent : modèle suivant
      }
      dernierStatut = reponse.status; modeleUtilise = modele;
      if (reponse.status === 400 && avecReflexion) { dernierDetail = (await reponse.text()).slice(0, 300); continue; } // réglage refusé : on réessaie sans
      break;
    }
    if (!reponse) continue;
    if (reponse.ok) break;
    // modèle introuvable (400/404), quota épuisé (429) ou serveur Google surchargé (500/502/503/504) → modèle suivant
    if (![400, 404, 429, 500, 502, 503, 504].includes(reponse.status)) break;
    dernierDetail = (await reponse.text()).slice(0, 300);
  }
  if (!reponse) throw new ErreurIA('Gemini trop lent à répondre, réessaie');
  if (!reponse.ok) {
    const detail = dernierDetail || (await reponse.text().catch(() => '')).slice(0, 300);
    const message = dernierStatut === 429 ? 'quota gratuit Gemini atteint, réessaie dans une minute'
      : dernierStatut >= 500 ? 'les serveurs Gemini sont surchargés, réessaie dans quelques minutes'
      : (dernierStatut === 403 || /API key/i.test(detail)) ? 'clé Gemini refusée, vérifie GEMINI_API_KEY sur Netlify'
      : `Gemini a répondu ${dernierStatut}`;
    throw new ErreurIA(message, detail);
  }
  const data = await reponse.json();
  const texte = (data?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!texte) throw new ErreurIA('Gemini a renvoyé une réponse vide');
  dernierBonModele = modeleUtilise;
  return { texte, ia: 'Gemini', modele: modeleUtilise };
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
// Gemini (gratuit) passe EN PREMIER. ChatGPT (payant) ne sert que si GEMINI_API_KEY manque,
// ou si tu ajoutes sur Netlify la variable IA_PRIORITE = openai.
// Renvoie { texte, ia, modele, avertissement? } ; lève une ErreurIA si aucune IA ne répond.
export async function demanderIA({ systeme, prompt, maxSortie = 600 }) {
  finAppel = Date.now() + LIMITE_MS;
  const aOpenAI = !!env('OPENAI_API_KEY'), aGemini = !!env('GEMINI_API_KEY');
  if (!aOpenAI && !aGemini) throw new ErreurIA('aucune clé IA sur Netlify (GEMINI_API_KEY)');
  const openaiDabord = aOpenAI && (!aGemini || String(env('IA_PRIORITE') || '').toLowerCase() === 'openai');
  if (!openaiDabord) return demanderGemini({ systeme, prompt, maxSortie });
  const finTotale = finAppel;
  if (aGemini) finAppel = Date.now() + 5500;
  try { return await demanderOpenAI({ systeme, prompt, maxSortie }); }
  catch (e) {
    if (!aGemini) throw e;
    finAppel = finTotale;
    const secours = await demanderGemini({ systeme, prompt, maxSortie });
    return { ...secours, avertissement: `ChatGPT indisponible (${e.message}), réponse par Gemini` };
  }
}

// Lit le JSON renvoyé par l'IA (enlève d'éventuels ```json … ```).
export function lireJSON(texte) {
  const propre = String(texte || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(propre); } catch {}
  const m = propre.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
