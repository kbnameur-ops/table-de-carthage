# La Table de Carthage

Site vitrine du restaurant tunisien **La Table de Carthage**.
Site statique — aucune dépendance, aucun build : il suffit d'ouvrir `index.html`.

## Structure

```
index.html                 page unique (hero, héritage, carte, signatures, expérience, réservation)
assets/css/style.css       styles + animations
assets/js/menu-data.js     la carte (source unique : affichage + données SEO)
assets/js/main.js          interactions
assets/img/logo.jpg        sceau de la maison
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

Le formulaire de réservation valide et confirme côté navigateur, mais
**n'envoie rien** : à brancher sur un service d'envoi (Formspree, Netlify Forms,
ou un `mailto:`) dans `bookForm()` de `assets/js/main.js`.

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

## Mise en ligne

N'importe quel hébergement statique : GitHub Pages, Netlify, Vercel, ou un
simple dossier sur un serveur web.
