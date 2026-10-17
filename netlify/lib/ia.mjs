// My I-Car — branchement commun vers l'IA, utilisé par les deux pilotes.
//
// 1. ChatGPT (OpenAI) si la variable secrète OPENAI_API_KEY existe sur Netlify.
// 2. Sinon, ou si OpenAI refuse (crédit épuisé, clé invalide…), Gemini avec GEMINI_API_KEY.
//
// Réglages facultatifs (variables Netlify) :
//   OPENAI_MODEL  : modèle OpenAI (par défaut gpt-6-sol ; gpt-6-luna est ~20 fois moins cher)
//   OPENAI_EFFORT : réflexion avant de répondre : none, low (défaut), medium
//   GEMINI_MODEL  : modèle Gemini prioritaire

const env = (k) => (globalThis.Netlify?.env?.get(k)) ?? process.env[k];

export class ErreurIA extends Error {
  constructor(message, detail = '') { super(message); this.detail = detail; }
}

// ── ChatGPT (OpenAI) ────────────────────────────────────────────────────────
async function demanderOpenAI({ systeme, prompt, maxSortie }) {
  const key = env('OPENAI_API_KEY');
  // Si un modèle n'est pas accessible avec ton compte, on essaie le suivant.
  const modeles = [...new Set([env('OPENAI_MODEL'), 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.4-mini', 'gpt-5-mini'].filter(Boolean))];
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
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(corps)
      });
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
async function demanderGemini({ systeme, prompt, maxSortie }) {
  const key = env('GEMINI_API_KEY');
  // Si le quota gratuit du modèle principal est épuisé (429), on bascule sur un modèle plus léger.
  const modeles = [...new Set([env('GEMINI_MODEL'), 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'].filter(Boolean))];
  let reponse, dernierStatut = 0, modeleUtilise = '';
  for (const modele of modeles) {
    const generationConfig = { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: maxSortie };
    if (modele.startsWith('gemini-2.5')) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    reponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systeme }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig
      })
    });
    dernierStatut = reponse.status; modeleUtilise = modele;
    // modèle introuvable (404/400) ou quota épuisé (429) → on essaie le suivant
    if (![400, 404, 429].includes(reponse.status)) break;
  }
  if (!reponse.ok) {
    const detail = (await reponse.text()).slice(0, 300);
    const message = dernierStatut === 429 ? 'quota gratuit Gemini atteint, réessaie dans une minute'
      : (dernierStatut === 403 || /API key/i.test(detail)) ? 'clé Gemini refusée, vérifie GEMINI_API_KEY'
      : `Gemini a répondu ${dernierStatut}`;
    throw new ErreurIA(message, detail);
  }
  const data = await reponse.json();
  const texte = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  return { texte, ia: 'Gemini', modele: modeleUtilise };
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
// Renvoie { texte, ia, modele, avertissement? } ; lève une ErreurIA si aucune IA ne répond.
export async function demanderIA({ systeme, prompt, maxSortie = 600 }) {
  const aOpenAI = !!env('OPENAI_API_KEY'), aGemini = !!env('GEMINI_API_KEY');
  if (!aOpenAI && !aGemini) throw new ErreurIA('aucune clé IA sur Netlify (OPENAI_API_KEY ou GEMINI_API_KEY)');
  if (aOpenAI) {
    try { return await demanderOpenAI({ systeme, prompt, maxSortie }); }
    catch (e) {
      if (!aGemini) throw e;
      const secours = await demanderGemini({ systeme, prompt, maxSortie });
      return { ...secours, avertissement: `ChatGPT indisponible (${e.message}), réponse par Gemini` };
    }
  }
  return demanderGemini({ systeme, prompt, maxSortie });
}

// Lit le JSON renvoyé par l'IA (enlève d'éventuels ```json … ```).
export function lireJSON(texte) {
  const propre = String(texte || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(propre); } catch {}
  const m = propre.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
