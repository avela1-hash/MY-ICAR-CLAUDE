# Installer My I-Car pour un nouveau garage

Un site Netlify par garage, tous branchés sur le même dépôt GitHub.
Chaque site a sa propre base (Netlify Blobs) : les données des garages ne se mélangent jamais.
Une mise à jour poussée sur `main` part chez tous les garages en même temps.

Le site de la Nouvelle Carrosserie de la Jomayere (`tangerine-naiad-424468.netlify.app`) garde
son profil de départ. Tout autre site démarre vierge.

## Étapes

1. Netlify → **Add new project** → **Import an existing project** → GitHub → `avela1-hash/MY-ICAR-CLAUDE`, branche `main` → Deploy.
2. Project configuration → **Environment variables**, ajouter :
   - `CODE_EQUIPE` : le code du patron (accès total). À lui donner en main propre.
   - `PATRON` : le prénom du patron, tel qu'il veut être appelé (ex. `Marc`).
   - `GEMINI_API_KEY` : la clé Google AI Studio pour le pilote vocal.
3. Project configuration → **Visitor access** : laisser **Public** (les données restent protégées par les codes).
4. Deploys → **Trigger deploy** pour prendre en compte les variables.
5. Le patron ouvre le site, tape son code, puis remplit **Plus → Mon garage** : identité (avec l'adresse
   « code postal + ville » pour la météo), taux, voitures de prêt, équipe (lui avec le rôle « Gérant »),
   fournisseurs.
6. Il donne un code perso à chaque membre : **Plus → Accès et sauvegardes**.
7. Chacun active ses alertes : **Plus → 🔔 Alertes sur ce téléphone**.

## Ce qui est propre à la Jomayere (activé seulement sur son site)

Profil de départ (identité, équipe, flotte, Julien et Didier), reprise des rendez-vous TimeTree,
dédicace à Enzo, position météo de Saint-Étienne. Si la Jomayere passe sur un nom de domaine à elle,
l'ajouter dans la ligne `var JOMAYERE=` de `index.html`.
