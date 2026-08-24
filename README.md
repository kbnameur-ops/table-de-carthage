# La Table de Carthage

Site et back-office du restaurant tunisien **La Table de Carthage** — application
dynamique Node.js/Express/SQLite : réservation en ligne avec disponibilités
réelles, commande à emporter, espace client, et un salon (back-office) pour
tout gérer sans toucher au code.

## Démarrage rapide

```bash
npm install
npm run seed        # importe la carte de départ et crée 2 services
npm run admin -- "vous@exemple.fr" "un-mot-de-passe-d-au-moins-10-caracteres" "Votre nom"
npm start            # http://localhost:3000
```

- Le site public est servi à `/`.
- Le salon (back-office) est à `/salon/connexion`, avec le compte créé ci-dessus.
- La base est un unique fichier SQLite : `data/restaurant.db` (créé au premier lancement).
  Sauvegarder = copier ce fichier.

`npm run dev` relance le serveur automatiquement à chaque modification de fichier
(`node --watch`) — pratique en développement, à ne pas utiliser en production.

## Architecture

```
server/
  index.js              point d'entrée : assemble middlewares et routes
  db.js                 connexion SQLite, applique schema.sql au démarrage
  schema.sql             tables (voir plus bas)
  seed.js                importe assets/js/menu-data.js dans la base (une fois)
  create-admin.js        crée/réinitialise un compte salon (ligne de commande)
  middleware.js          session, jeton CSRF, exigerClient/exigerAdmin
  lib/
    auth.js               mots de passe (scrypt), sessions, anti-force-brute
    clients.js             identification client (téléphone + date de naissance)
    availability.js        calcul des créneaux disponibles par service
    money.js, phone.js, validate.js, slug.js, reference.js, image.js, layout.js
  routes/
    api.js, api_carte.js           disponibilités + carte publique (JSON)
    reservation.js, commande.js    tunnels publics
    compte.js                       espace client
    salon.js, salon_carte.js, salon_services.js,
    salon_reservations.js, salon_commandes.js   back-office
  views/                 gabarits EJS (tunnels, compte, salon)
  public/
    css/app.css           styles de l'application (tunnels, compte, salon)
    uploads/plats/         photos des plats gérées depuis le salon
data/restaurant.db       base SQLite (non versionnée)
test/                     tests automatisés (node --test)
```

Le site vitrine (page d'accueil, animations, direction artistique) reste dans
`index.html` / `assets/`, servi tel quel par le serveur — voir plus bas pour ce
qui le concerne spécifiquement. Tout ce qui suit décrit la partie applicative.

## Le salon (back-office)

Accessible à `/salon/connexion` avec un compte créé via `npm run admin`.

- **La carte** (`/salon/carte`) — catégories et plats : créer, modifier,
  réordonner (↑/↓), masquer sans supprimer, marquer « signature » ou
  « végétarien », autoriser ou non à emporter. Chaque plat peut recevoir une
  photo (JPEG/PNG/WebP, 8 Mo max) : elle est automatiquement redimensionnée
  à 1000 px de large et recompressée en JPEG qualité 82.
- **Services & capacité** (`/salon/services`) — un service définit des jours,
  une plage horaire et un pas entre créneaux (ex. 30 min), avec deux limites
  *indépendantes* : le nombre de **tables** (réservations simultanées) et le
  nombre de **couverts** (personnes) au total sur un même créneau. On peut
  aussi déclarer des **fermetures exceptionnelles** (congés, jour férié,
  privatisation) qui retirent une date des deux tunnels.
- **Réservations** (`/salon/reservations`) — vue par date et par statut
  (en attente, confirmée, honorée, annulée, absente), avec le total de
  couverts du jour et un changement de statut en un clic.
- **Commandes** (`/salon/commandes`) — même principe, avec le détail des
  plats commandés et le total du jour.

Toute modification faite dans le salon est immédiatement visible sur le site
public : la carte de la page d'accueil n'est plus un fichier statique, elle
est servie en direct par `/api/carte` (voir plus bas).

## Les tunnels publics

**Réservation** (`/reserver`) — le client choisit une date et un nombre de
couverts ; les créneaux affichés viennent du service du jour et excluent ceux
déjà complets (table ou couverts). Le créneau est revérifié côté serveur au
moment de la confirmation, pour ne jamais faire confiance à un affichage qui
aurait pu se périmer de quelques secondes.

**Commande à emporter** (`/commander`) — la carte (uniquement les plats
autorisés à emporter), un panier avec quantités, une heure de retrait parmi
les horaires d'ouverture. Le total est toujours recalculé côté serveur à
partir des prix actuels de la base — jamais à partir de ce que le formulaire
a soumis.

Les deux tunnels demandent les mêmes coordonnées (prénom, nom, e-mail,
téléphone, date de naissance) : c'est ce qui crée le compte client.

## L'espace client

Créé automatiquement à la première réservation ou commande. L'accès se fait
avec le **téléphone + la date de naissance** (`/compte/connexion`) — pas de
mot de passe séparé à retenir. Un même téléphone déjà connu doit présenter la
même date de naissance pour être reconnu, sinon la tentative est refusée :
sans ce contrôle, connaître le numéro de quelqu'un suffirait à voir son nom,
son e-mail et l'historique de ses réservations.

Depuis son espace, un client voit ses réservations et commandes à venir et
passées, et peut annuler celles qui ne sont pas encore honorées.

**Limite assumée** : téléphone + date de naissance reste moins sûr qu'un vrai
mot de passe — un proche connaissant les deux passerait le contrôle. C'est un
compromis délibéré (aucun mot de passe à retenir, aucun SMS/e-mail à
envoyer), protégé par une limitation à 5 tentatives / 15 minutes par
numéro + IP. Ne pas y stocker d'information plus sensible que ce qui s'y
trouve déjà (nom, contact, historique de commandes).

## Sécurité

- **Mots de passe** (salon uniquement) : hachés avec `scrypt` (sel aléatoire,
  comparaison en temps constant). Jamais en clair, jamais réversibles.
- **Sessions** : jeton aléatoire de 32 octets, stocké côté serveur ; le
  cookie ne porte que ce jeton (`HttpOnly`, `SameSite=Lax`, `Secure` en
  production). Une session existe dès la première visite (rôle « invité »)
  pour porter un jeton CSRF même avant toute connexion.
- **CSRF** : chaque formulaire embarque le jeton de la session ; toute
  requête de modification le revérifie.
- **Anti-force-brute** : 5 tentatives / 15 minutes par numéro de téléphone
  (espace client) ou par e-mail (salon), combinés à l'adresse IP.
- **Autorisation** : les routes du salon vérifient explicitement
  `exigerAdmin` route par route (voir la note dans `salon_carte.js` sur le
  piège d'un `router.use()` non préfixé, qui s'appliquerait par erreur à
  tout le reste de l'application).
- **Montants** : toujours en centimes (entiers) en base, jamais en flottant.

## Base de données

Un seul fichier SQLite (`data/restaurant.db`), en mode WAL. Tables
principales : `categories`, `plats`, `services`, `fermetures`, `clients`,
`reservations`, `commandes` + `commande_lignes`, `admins`, `sessions`,
`tentatives`, `reglages`. Le détail de chaque colonne et sa raison d'être
sont commentés dans `server/schema.sql`.

## Déploiement

- Définir `NODE_ENV=production` (active `Secure` sur le cookie de session —
  indispensable dès que le site est servi en HTTPS, ce qu'il doit être).
- `PORT` (par défaut 3000) et `DB_PATH` (par défaut `data/restaurant.db`)
  sont configurables par variable d'environnement.
- Faire tourner `node server/index.js` derrière un reverse proxy (Nginx,
  Caddy) qui termine le TLS — un VPS à quelques euros par mois suffit
  largement (le trafic d'un restaurant reste modeste).
- Sauvegarder régulièrement `data/restaurant.db` (copie de fichier : il n'y a
  rien d'autre côté base de données).

## Tests

```bash
npm test
```

Couvre les fonctions les plus sensibles aux erreurs silencieuses : formatage
et parsing des montants, normalisation des numéros de téléphone, validation
des dates/heures. Le calcul des créneaux disponibles (`lib/availability.js`)
et l'identification client (`lib/clients.js`) ont été vérifiés manuellement
de bout en bout (créneaux qui se remplissent, revalidation au moment de la
confirmation, téléphone déjà associé à une autre date de naissance) mais
n'ont pas encore de suite automatisée — à ajouter si le projet grossit.

---

# Site vitrine (page d'accueil)

Ce qui suit documente `index.html` / `assets/`, servis tels quels par le
serveur. Ces informations restaient valables avant l'ajout du salon et le
demeurent, à un détail près : **la carte affichée sur la page d'accueil
provient maintenant de `/api/carte` (donc du salon), pas directement de
`menu-data.js`** — ce fichier ne sert plus que de secours hors-ligne et de
source pour `npm run seed`.

## Structure

```
index.html                 page unique (hero, héritage, carte, signatures,
                           expérience, formules & privatisation, réservation)
assets/css/style.css       styles + animations
assets/js/menu-data.js     la carte (source unique : affichage + données SEO)
assets/js/main.js          interactions
assets/img/logo.jpg        sceau de la maison
assets/img/salle.jpg       photo de la salle
assets/img/plats/          photos des plats (nommées comme la clé `photo`)
                           couscous-agneau-alt.jpg n'est pas utilisée : c'est
                           la photo d'agneau précédente, gardée en réserve
```

## Modifier la carte

**Pour le site en ligne, ça se passe dans le salon** (`/salon/carte`), pas
dans ce fichier — voir la section « Le salon » plus haut. `menu-data.js` ne
sert plus qu'à deux choses : amorcer la base au premier lancement
(`npm run seed`) et servir de secours hors-ligne si `/api/carte` est
injoignable (page ouverte sans serveur, export en fichier unique). Le
modifier ici n'a donc plus d'effet sur ce que voient les clients une fois le
serveur en service.

Format de chaque catégorie, pour mémoire :

```js
{
  id: 'couscous',                 // identifiant du filtre
  name: 'Couscous',               // titre affiché
  tagline: 'Semoule roulée…',     // sous-titre
  items: [
    { name: 'Couscous Royal', desc: '…', price: 20, star: true, veg: false }
  ]
}
```

- `price` : nombre en euros (`16.5` s'affiche « 16,50 € »).
- `star: true` : badge **Signature**.
- `veg: true` : pastille verte « végétarien ».
- `photo: 'nom-du-fichier'` : affiche une vignette cliquable. Déposez l'image
  dans `assets/img/plats/nom-du-fichier.jpg` — largeur 1000 px, qualité 82,
  c'est le réglage utilisé pour les photos actuelles.

### Règle d'écriture des descriptions

Ne décrivez que ce qui est vérifiable : les ingrédients du plat. **Pas de
procédé ni d'origine** (« roulé à la main », « au charbon de bois », « zgougou
de Nabeul ») tant que ce n'est pas confirmé par la cuisine — ces mentions
engagent le restaurant auprès du client.

Le bouton de filtre et les données structurées `schema.org/Restaurant`
(référencement Google) se régénèrent automatiquement.

## Coordonnées du restaurant

Renseignées dans `index.html` (section *Réserver*, pied de page, mentions légales)
et dans les données structurées de `assets/js/main.js` :

| | |
|---|---|
| Adresse | 6 boulevard Richard Wallace, 92800 Puteaux |
| Téléphone | 07 61 97 67 11 |
| Horaires | Lundi–Samedi 12h–23h · Dimanche 12h–22h (7j/7, service continu) |
| Instagram | [@latab_ledecarthage](https://www.instagram.com/latab_ledecarthage) |
| Facebook | [La Table de Carthage](https://www.facebook.com/p/La-Table-de-Carthage-61583761137287/) |
| Fiche Google | [share.google/F2eC15UbPln65rvK2](https://share.google/F2eC15UbPln65rvK2) |
| SIREN / SIRET | 100 477 553 / 100 477 553 00018 |
| TVA | FR30 100477553 |
| APE | 56.10A — Restauration traditionnelle |
| Forme | SAS · RCS Nanterre · Président : Ayoub Khlifi |

Toutes ces informations sont vérifiées. Pour changer le téléphone, remplacer les
3 occurrences dans `index.html` (`07 61 97 67 11` à l'affichage, `tel:+33761976711`
dans les liens) et la clé `telephone` des données structurées dans
`assets/js/main.js`.

## Demandes clients → WhatsApp

Aucun serveur, aucun formulaire à héberger : le site compose le message et
l'ouvre dans WhatsApp sur le **07 61 97 67 11**, il ne reste au client qu'à
appuyer sur envoyer.

- **Formulaire de réservation** — les champs (demande, nom, téléphone, date,
  heure, couverts, précisions) sont mis en forme en un message lisible.
  Si le navigateur bloque l'ouverture d'onglet, un lien de secours s'affiche.
- **Boutons des formules** — « Demander la formule » et « Demander un devis »
  ouvrent WhatsApp avec un message adapté à chaque offre.
- **Liens directs** — section Réserver et pied de page.

Le numéro est défini une seule fois, dans la constante `WHATSAPP` en tête de
`bookForm` (`assets/js/main.js`), au format international sans `+` :
`33761976711`. Les textes préremplis des deux boutons sont dans `offerButtons()`.

## Formules & privatisation

La section `#formules` présente les deux offres. Le texte est volontairement
descriptif : **aucun tarif, capacité d'accueil ni durée n'y est avancé**, faute
de les connaître. Ajoutez-les dans `index.html` (section « Recevoir ») dès que
ces éléments sont arrêtés — ce sont les premières questions des clients.

## Direction artistique

Bleu punique, or de Byrsa, chaux de Sidi Bou Saïd — repris du logo. Colonne
dessinée au trait, frise géométrique, mosaïque en fond, poussière d'or animée
sur le hero. Toutes les animations respectent `prefers-reduced-motion`.

## Référencement

Les données structurées `schema.org/Restaurant` (adresse, géolocalisation,
téléphone, horaires, `sameAs` vers Instagram / Facebook, et la carte complète)
sont générées à partir de `menu-data.js` et injectées au chargement. Elles
permettent à Google d'afficher le menu et la fiche établissement dans ses
résultats. Testez-les avec le
[test des résultats enrichis](https://search.google.com/test/rich-results).

## Version en fichier unique

```bash
node build.mjs              # → dist/index.html  (page autonome)
node build.mjs --fragment   # → dist/artifact.html (sans <html>/<head>/<body>)
```

Le CSS, le JavaScript et le logo sont incorporés dans le HTML : `dist/index.html`
s'ouvre par double-clic, s'envoie par mail et s'héberge n'importe où, sans le
dossier `assets`. Sans serveur pour répondre à `/api/carte`, la page retombe
automatiquement sur la carte embarquée dans `menu-data.js` — un instantané
figé au moment du build, pas la carte à jour du salon. Les images des données
structurées sont retirées (elles pointeraient vers des fichiers absents) :
**pour la mise en production, déployez la version serveur** (`npm start`),
qui garde le référencement complet et la carte à jour. Cet export en fichier
unique reste pratique pour montrer le site ou le déposer chez un hébergeur
qui n'accepte qu'un fichier. `dist/` n'est pas versionné : relancez le build
après chaque modification.

## Mise en ligne du site vitrine seul

Sans réservation, commande ni salon — juste `index.html` en secours
`menu-data.js` — n'importe quel hébergement statique convient : GitHub
Pages, Netlify, Vercel, ou un simple dossier sur un serveur web. Déposez
`index.html` et le dossier `assets`, ou le seul `dist/index.html`.

Pour bénéficier du salon, des tunnels et de la carte à jour en direct, c'est
la section « Déploiement » plus haut qui s'applique : il faut le serveur
Node en service (`npm start`), pas un hébergement purement statique.
