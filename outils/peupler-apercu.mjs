/** Peuple une base de PRÉVERSION, et elle seule.
 *
 *  Vercel donne à chaque déploiement de préversion sa propre base, vide.
 *  Sans ce script, une préversion s'ouvre sur un site sans carte, sans
 *  horaires et sans compte pour entrer au salon — impossible d'y juger
 *  quoi que ce soit, ce qui est pourtant tout l'intérêt d'une préversion.
 *
 *  ── Ce qui garantit que la production n'est jamais touchée ──
 *  Deux verrous, et il faut les deux :
 *    1. `VERCEL_ENV` doit valoir exactement 'preview' ;
 *    2. la base doit être vide de toute commande et de toute réservation.
 *  Le second protège du cas où quelqu'un pointerait par erreur une
 *  préversion vers la base de production : on ne sème pas dans une base qui
 *  porte déjà de l'activité réelle.
 *
 *  ── Le mot de passe du salon ──
 *  Tiré au sort à chaque déploiement et imprimé dans le journal de build.
 *  Rien n'est écrit en dur dans le dépôt — qui est public — et chaque
 *  préversion a le sien.
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.VERCEL_ENV !== 'preview') {
  console.log('↷ Pas une préversion : aucun jeu de démonstration.');
  process.exit(0);
}

const { une, query, executer } = await import('../server/db.js');
const { hacherMotDePasse } = await import('../server/lib/auth.js');

/** Refuse de semer dans une base qui porte de l'activité réelle. */
const { commandes } = await une(`SELECT COUNT(*)::int AS commandes FROM commandes`);
const { resas } = await une(`SELECT COUNT(*)::int AS resas FROM reservations`);
if (commandes > 0 || resas > 0) {
  console.log(`↷ Cette base porte déjà ${commandes} commande(s) et ${resas} réservation(s) : on n'y touche pas.`);
  process.exit(0);
}

// ── La carte, les services, les tables ──────────────────────────────────
// On réutilise le semis existant plutôt que d'en écrire un second : il est
// déjà sans effet si la base contient des catégories.
const { n: nbCategories } = await une(`SELECT COUNT(*)::int AS n FROM categories`);
if (nbCategories === 0) {
  console.log('· Semis de la carte, des services et des tables…');
  // En sous-processus, et non par `import` : seed.js termine le processus
  // en fin de course, ce qui emporterait tout ce qui suit.
  const r = spawnSync(process.execPath, [join(racine, 'server', 'seed.js')],
    { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error('✗ Le semis de la carte a échoué.');
    process.exit(1);
  }
} else {
  console.log(`· Carte déjà présente (${nbCategories} catégories).`);
}

async function peuplerLeReste() {
  // ── Un compte pour entrer au salon ────────────────────────────────────
  const { n: nbAdmins } = await une(`SELECT COUNT(*)::int AS n FROM admins`);
  if (nbAdmins === 0) {
    const motDePasse = 'apercu-' + randomBytes(6).toString('hex');
    await executer(
      `INSERT INTO admins (email, mot_de_passe, nom) VALUES ($1, $2, 'Aperçu')`,
      ['apercu@table-de-carthage.test', hacherMotDePasse(motDePasse)]
    );
    console.log('');
    console.log('  ╭─ Accès au salon de cette préversion ─────────────────');
    console.log('  │  adresse      apercu@table-de-carthage.test');
    console.log(`  │  mot de passe ${motDePasse}`);
    console.log('  ╰──────────────────────────────────────────────────────');
    console.log('');
  }

  // ── Deux soirées de démonstration ─────────────────────────────────────
  const { n: nbEvenements } = await une(`SELECT COUNT(*)::int AS n FROM evenements`);
  if (nbEvenements > 0) {
    console.log(`· ${nbEvenements} soirée(s) déjà en base.`);
    return;
  }

  // Les photos sont empruntées aux plats que le semis vient d'installer :
  // elles sont déjà dans le stockage de CETTE préversion, avec des URL
  // valides. Rien à téléverser, et aucune image cassée.
  const illustrations = await query(
    `SELECT nom, photo FROM plats WHERE photo IS NOT NULL AND photo <> '' ORDER BY position LIMIT 8`);
  if (!illustrations.length) console.log('· Aucune photo de plat disponible : les soirées seront sans bandeau.');

  const soirees = [
    {
      slug: 'nuit-andalouse', titre: 'Nuit andalouse', jours: 24, heure: '20:00',
      prix: 4500, places: 40, position: 0,
      accroche: "Un oud, une voix, et les mezzés qui circulent jusqu'à minuit.",
      texte: "Le luthiste ouvre la soirée seul, sur un maqâm — dix minutes où personne ne parle.\n\n"
           + "Puis la salle se remplit : mezzés à partager, tajine de poulet aux olives et citron confit, "
           + "et le thé aux pins que l'on sert debout, comme au pays.\n\n"
           + "On ne s'assoit pas à une table, on s'installe pour la nuit.",
    },
    {
      slug: 'tables-du-ramadan', titre: 'Les tables du Ramadan', jours: 52, heure: '18:45',
      prix: 3200, places: 60, position: 1,
      accroche: "La rupture du jeûne, servie comme à la maison, chaque soir du mois.",
      texte: "Chorba frik fumante, brik à l'œuf, dattes et lait fermenté pour rompre.\n\n"
           + "Puis le plat change chaque soir — mloukhia le lundi, kamounia le mardi, "
           + "couscous au poisson le vendredi.\n\n"
           + "Le service commence à l'heure exacte de l'adhan. Nous vous conseillons d'arriver un peu avant.",
    },
  ];

  for (const s of soirees) {
    const e = await une(
      `INSERT INTO evenements (slug, titre, accroche, texte, date, heure, prix_cents, places, visible, position)
       VALUES ($1,$2,$3,$4,(CURRENT_DATE + ($5)::int)::text,$6,$7,$8,true,$9) RETURNING id`,
      [s.slug, s.titre, s.accroche, s.texte, s.jours, s.heure, s.prix, s.places, s.position]
    );
    // Quatre photos chacune : de quoi voir le ruban défiler pour de bon.
    const lot = illustrations.slice(s.position * 4, s.position * 4 + 4);
    const choisies = lot.length >= 2 ? lot : illustrations.slice(0, 4);
    for (let i = 0; i < choisies.length; i++) {
      await executer(
        `INSERT INTO evenement_photos (evenement_id, url, legende, position) VALUES ($1,$2,$3,$4)`,
        [e.id, choisies[i].photo, choisies[i].nom, i]);
    }
    console.log(`· Soirée « ${s.titre} » créée avec ${choisies.length} photos.`);
  }
}

await peuplerLeReste();
console.log('✓ Préversion peuplée.');
process.exit(0);
