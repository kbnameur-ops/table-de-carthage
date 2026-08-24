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

## À personnaliser avant mise en ligne

Ces valeurs sont des **espaces réservés** dans `index.html` :

- l'adresse postale (section *Réserver* et pied de page) ;
- le téléphone `01 00 00 00 00` (3 occurrences, dont deux liens `tel:`) ;
- les horaires si différents de *mardi–dimanche, 12h–14h30 · 19h–23h*.

Le formulaire de réservation valide et confirme côté navigateur, mais
**n'envoie rien** : à brancher sur un service d'envoi (Formspree, Netlify Forms,
ou un `mailto:`) dans `bookForm()` de `assets/js/main.js`.

## Direction artistique

Bleu punique, or de Byrsa, chaux de Sidi Bou Saïd. Colonne dessinée au trait,
frise géométrique, mosaïque en fond, poussière d'or animée sur le hero.
Toutes les animations respectent `prefers-reduced-motion`.

## Mise en ligne

N'importe quel hébergement statique : GitHub Pages, Netlify, Vercel, ou un
simple dossier sur un serveur web.
