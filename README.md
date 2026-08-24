# La Table de Carthage

Site vitrine du restaurant tunisien **La Table de Carthage**.
Site statique — aucune dépendance, aucun build : il suffit d'ouvrir `index.html`.

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

Tout se passe dans `assets/js/menu-data.js`. Chaque catégorie :

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
dossier `assets`. Les images des données structurées y sont retirées (elles
pointeraient vers des fichiers absents) : **pour la mise en production,
déployez la version multi-fichiers**, qui garde le référencement complet. Pratique pour montrer le site ou le déposer chez un hébergeur
qui n'accepte qu'un fichier. `dist/` n'est pas versionné : relancez le build
après chaque modification.

## Mise en ligne

N'importe quel hébergement statique : GitHub Pages, Netlify, Vercel, ou un
simple dossier sur un serveur web. Déposez `index.html` et le dossier `assets`,
ou le seul `dist/index.html`.
