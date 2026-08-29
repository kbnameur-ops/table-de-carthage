# Documentation

Deux documents, ouvrables directement dans un navigateur.

| Fichier | Pour qui | Contenu |
|---|---|---|
| `dossier-technique.html` | Qui reprend le code | Architecture, modèle de données, invariants tenus par la base, sécurité, règles métier, déploiement, exploitation. |
| `manuel-utilisation.html` | La direction et le personnel | Un chapitre par poste : salon, prise de commande, caisse, cuisine, cagnotte. Conçu pour être imprimé et affiché. |
| `Manuel-La-Table-de-Carthage.pdf` | À imprimer et distribuer | Le tirage A4 du manuel, régénéré par `npm run pdf`. |

Le PDF est un tirage du manuel, jamais une seconde version à tenir à jour :
après toute modification de `manuel-utilisation.html`, relancez `npm run pdf`.
Le script embarque les fontes dans une copie de travail avant de composer, pour
que le tirage ressemble au document et ne dépende pas des fontes de la machine.
Il a besoin de Playwright, que le projet n'embarque pas
(`npm i -D playwright && npx playwright install chromium`).

Ils décrivent la version 2.0. À relire après tout changement de règle métier —
en particulier le taux de fidélité, les états de cuisine et les droits du
personnel, qui y sont documentés avec leurs valeurs.
