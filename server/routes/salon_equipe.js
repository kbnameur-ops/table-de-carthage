import { Router } from 'express';
import { query, une, executer } from '../db.js';
import { exigerAdmin, verifierCsrf, redirigerRetour } from '../middleware.js';
import { dateValide, heureValide, texteNonVide } from '../lib/validate.js';
import { hacherMotDePasse } from '../lib/auth.js';

export const salonEquipeRouter = Router();

const POSTES = ['Salle', 'Cuisine', 'Plonge', 'Bar', 'Livraison', 'Direction'];
const STATUTS = ['present', 'absent', 'conge', 'maladie'];
const LIBELLES = { present: 'Présent', absent: 'Absent', conge: 'Congé', maladie: 'Maladie' };

const aujourdHui = () => new Date().toISOString().slice(0, 10);
const hhmm = () => new Date().toTimeString().slice(0, 5);

// ── L'équipe ───────────────────────────────────────────────
salonEquipeRouter.get('/salon/equipe', exigerAdmin, async (req, res, next) => {
  try {
    const employes = await query(`SELECT * FROM employes ORDER BY actif DESC, nom, prenom`);
    res.render('salon/equipe', {
      titre: 'Équipe', actif: 'equipe', employes, postes: POSTES,
      erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

function validerEmploye(body) {
  const erreurs = [];
  if (!texteNonVide(body.prenom, 40)) erreurs.push('Prénom requis.');
  if (!texteNonVide(body.nom, 40)) erreurs.push('Nom requis.');
  return erreurs;
}

salonEquipeRouter.post('/salon/equipe', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const erreurs = validerEmploye(req.body);
    if (erreurs.length) return res.redirect('/salon/equipe?erreur=' + encodeURIComponent(erreurs.join(' ')));
    await executer(
      `INSERT INTO employes (prenom, nom, poste, telephone, email) VALUES ($1, $2, $3, $4, $5)`,
      [
        req.body.prenom.trim(), req.body.nom.trim(), (req.body.poste || '').trim(),
        (req.body.telephone || '').trim(), (req.body.email || '').trim(),
      ]
    );
    res.redirect('/salon/equipe');
  } catch (err) { next(err); }
});

salonEquipeRouter.post('/salon/equipe/:id', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const erreurs = validerEmploye(req.body);
    if (erreurs.length) return res.redirect('/salon/equipe?erreur=' + encodeURIComponent(erreurs.join(' ')));
    await executer(
      `UPDATE employes SET prenom = $1, nom = $2, poste = $3, telephone = $4, email = $5, actif = $6 WHERE id = $7`,
      [
        req.body.prenom.trim(), req.body.nom.trim(), (req.body.poste || '').trim(),
        (req.body.telephone || '').trim(), (req.body.email || '').trim(), !!req.body.actif, req.params.id,
      ]
    );
    res.redirect('/salon/equipe');
  } catch (err) { next(err); }
});

// ── Accès à l'interface de prise de commande ───────────────
/** L'identifiant est volontairement court et sans arobase : il se tape au
 *  clavier tactile d'une tablette, debout, entre deux tables. */
const IDENTIFIANT = /^[a-z0-9][a-z0-9._-]{2,29}$/;

salonEquipeRouter.post('/salon/equipe/:id/acces', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const employe = await une(`SELECT * FROM employes WHERE id = $1`, [req.params.id]);
    if (!employe) return res.redirect('/salon/equipe');
    const echec = (msg) => res.redirect('/salon/equipe?erreur=' + encodeURIComponent(msg));

    const identifiant = (req.body.identifiant || '').trim().toLowerCase();
    const motDePasse = req.body.motDePasse || '';
    const accesService = !!req.body.accesService;
    const accesCuisine = !!req.body.accesCuisine;
    const actif = accesService || accesCuisine;

    if (!identifiant) return echec("Un identifiant est nécessaire pour donner l'accès.");
    if (!IDENTIFIANT.test(identifiant)) {
      return echec('Identifiant : 3 à 30 caractères, en minuscules, sans espace ni accent.');
    }
    // Un accès sans mot de passe n'en est pas un : on l'exige à la première
    // activation, et on le laisse facultatif ensuite pour pouvoir corriger
    // un identifiant sans avoir à réattribuer un mot de passe.
    if (!employe.mot_de_passe && !motDePasse) {
      return echec('Choisissez un mot de passe pour ce premier accès.');
    }
    if (motDePasse && motDePasse.length < 8) {
      return echec('Le mot de passe doit faire au moins 8 caractères.');
    }

    const pris = await une(
      `SELECT id FROM employes WHERE identifiant = $1 AND id <> $2`, [identifiant, employe.id]
    );
    if (pris) return echec('Cet identifiant est déjà utilisé par quelqu\'un d\'autre.');

    await executer(
      `UPDATE employes SET identifiant = $1, acces_service = $2, acces_cuisine = $3,
              mot_de_passe = COALESCE($4, mot_de_passe)
        WHERE id = $5`,
      [identifiant, accesService, accesCuisine,
       motDePasse ? hacherMotDePasse(motDePasse) : null, employe.id]
    );
    // Couper les deux accès doit couper les sessions en cours, pas seulement
    // les suivantes : une tablette déjà connectée resterait sinon ouverte.
    // Retirer un seul des deux se règle tout seul — les droits sont relus à
    // chaque requête par le middleware.
    if (!actif) {
      await executer(`DELETE FROM sessions WHERE role = 'serveur' AND sujet_id = $1`, [employe.id]);
    }
    res.redirect('/salon/equipe');
  } catch (err) { next(err); }
});

salonEquipeRouter.post('/salon/equipe/:id/acces/retirer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await executer(
      `UPDATE employes SET identifiant = NULL, mot_de_passe = NULL,
              acces_service = false, acces_cuisine = false WHERE id = $1`,
      [req.params.id]
    );
    await executer(`DELETE FROM sessions WHERE role = 'serveur' AND sujet_id = $1`, [req.params.id]);
    res.redirect('/salon/equipe');
  } catch (err) { next(err); }
});

salonEquipeRouter.post('/salon/equipe/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await executer(`DELETE FROM employes WHERE id = $1`, [req.params.id]);
    res.redirect('/salon/equipe');
  } catch (err) { next(err); }
});

// ── Planning de la semaine ─────────────────────────────────
/** Le lundi de la semaine contenant `date`. Le planning se lit par semaine
 *  entière : c'est la maille sur laquelle un restaurant construit ses shifts. */
function lundiDeLaSemaine(date) {
  const d = new Date(date + 'T00:00:00Z');
  const jour = d.getUTCDay() || 7;          // 1 = lundi … 7 = dimanche
  d.setUTCDate(d.getUTCDate() - (jour - 1));
  return d.toISOString().slice(0, 10);
}

function joursDeLaSemaine(lundi) {
  const jours = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(lundi + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    jours.push(d.toISOString().slice(0, 10));
  }
  return jours;
}

salonEquipeRouter.get('/salon/planning', exigerAdmin, async (req, res, next) => {
  try {
    const reference = dateValide(req.query.semaine) ? req.query.semaine : aujourdHui();
    const lundi = lundiDeLaSemaine(reference);
    const jours = joursDeLaSemaine(lundi);
    const dimanche = jours[6];

    const employes = await query(`SELECT * FROM employes WHERE actif = true ORDER BY nom, prenom`);
    const shifts = await query(
      `SELECT * FROM plannings WHERE date >= $1 AND date <= $2 ORDER BY debut`, [lundi, dimanche]
    );

    // Indexé par employé puis par jour : la vue est une grille, la lire
    // depuis un tableau plat obligerait à filtrer 7 × N fois.
    const grille = new Map();
    for (const e of employes) grille.set(e.id, Object.fromEntries(jours.map(j => [j, []])));
    for (const s of shifts) {
      const ligne = grille.get(s.employe_id);
      if (ligne && ligne[s.date]) ligne[s.date].push(s);
    }

    const heuresParEmploye = new Map();
    for (const e of employes) {
      let minutes = 0;
      for (const j of jours) {
        for (const s of grille.get(e.id)[j]) {
          const [hd, md] = s.debut.split(':').map(Number);
          const [hf, mf] = s.fin.split(':').map(Number);
          minutes += (hf * 60 + mf) - (hd * 60 + md);
        }
      }
      heuresParEmploye.set(e.id, minutes);
    }

    const precedente = new Date(lundi + 'T00:00:00Z');
    precedente.setUTCDate(precedente.getUTCDate() - 7);
    const suivante = new Date(lundi + 'T00:00:00Z');
    suivante.setUTCDate(suivante.getUTCDate() + 7);

    res.render('salon/planning', {
      titre: 'Planning', actif: 'equipe',
      lundi, jours, employes, grille, heuresParEmploye,
      semainePrecedente: precedente.toISOString().slice(0, 10),
      semaineSuivante: suivante.toISOString().slice(0, 10),
      aujourdHui: aujourdHui(),
      erreur: req.query.erreur || null, csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

salonEquipeRouter.post('/salon/planning', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const { employeId, date, debut, fin } = req.body;
    const retour = `/salon/planning?semaine=${encodeURIComponent(date || aujourdHui())}`;
    if (!dateValide(date) || !heureValide(debut) || !heureValide(fin) || debut >= fin) {
      return res.redirect(retour + '&erreur=' + encodeURIComponent('Horaires invalides.'));
    }
    const employe = await une(`SELECT id FROM employes WHERE id = $1`, [employeId]);
    if (!employe) return res.redirect(retour);

    await executer(
      `INSERT INTO plannings (employe_id, date, debut, fin, note) VALUES ($1, $2, $3, $4, $5)`,
      [employe.id, date, debut, fin, (req.body.note || '').trim().slice(0, 120)]
    );
    res.redirect(retour);
  } catch (err) { next(err); }
});

salonEquipeRouter.post('/salon/planning/:id/supprimer', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    await executer(`DELETE FROM plannings WHERE id = $1`, [req.params.id]);
    redirigerRetour(req, res, '/salon/planning');
  } catch (err) { next(err); }
});

// ── Présence du jour ───────────────────────────────────────
salonEquipeRouter.get('/salon/presences', exigerAdmin, async (req, res, next) => {
  try {
    const date = dateValide(req.query.date) ? req.query.date : aujourdHui();
    const employes = await query(`SELECT * FROM employes WHERE actif = true ORDER BY nom, prenom`);
    const pointages = await query(`SELECT * FROM pointages WHERE date = $1`, [date]);
    const shifts = await query(`SELECT * FROM plannings WHERE date = $1 ORDER BY debut`, [date]);

    const parEmploye = new Map(pointages.map(p => [p.employe_id, p]));
    const shiftsParEmploye = new Map();
    for (const s of shifts) {
      if (!shiftsParEmploye.has(s.employe_id)) shiftsParEmploye.set(s.employe_id, []);
      shiftsParEmploye.get(s.employe_id).push(s);
    }

    const lignes = employes.map(e => ({
      ...e,
      pointage: parEmploye.get(e.id) || null,
      shifts: shiftsParEmploye.get(e.id) || [],
    }));

    res.render('salon/presences', {
      titre: 'Présences', actif: 'equipe', date, lignes,
      statuts: STATUTS, libelles: LIBELLES, maintenant: hhmm(),
      csrfToken: res.locals.csrfToken,
    });
  } catch (err) { next(err); }
});

/** Pointe une arrivée, un départ, ou pose un statut d'absence. Un seul
 *  enregistrement par personne et par jour : le formulaire écrase la ligne
 *  existante plutôt que d'en empiler plusieurs. */
salonEquipeRouter.post('/salon/presences/:employeId', exigerAdmin, verifierCsrf, async (req, res, next) => {
  try {
    const { date, action } = req.body;
    if (!dateValide(date)) return redirigerRetour(req, res, '/salon/presences');
    const employe = await une(`SELECT id FROM employes WHERE id = $1`, [req.params.employeId]);
    if (!employe) return redirigerRetour(req, res, '/salon/presences');

    const existant = await une(
      `SELECT * FROM pointages WHERE employe_id = $1 AND date = $2`, [employe.id, date]
    );

    if (action === 'arrivee') {
      const heure = heureValide(req.body.heure) ? req.body.heure : hhmm();
      await executer(
        `INSERT INTO pointages (employe_id, date, arrivee, statut) VALUES ($1, $2, $3, 'present')
         ON CONFLICT (employe_id, date) DO UPDATE SET arrivee = excluded.arrivee, statut = 'present'`,
        [employe.id, date, heure]
      );
    } else if (action === 'depart') {
      const heure = heureValide(req.body.heure) ? req.body.heure : hhmm();
      // Un départ sans arrivée n'a pas de sens : on ne crée pas la ligne.
      if (existant?.arrivee) {
        await executer(`UPDATE pointages SET depart = $1 WHERE id = $2`, [heure, existant.id]);
      }
    } else if (action === 'statut' && STATUTS.includes(req.body.statut)) {
      await executer(
        `INSERT INTO pointages (employe_id, date, statut, note) VALUES ($1, $2, $3, $4)
         ON CONFLICT (employe_id, date) DO UPDATE SET statut = excluded.statut, note = excluded.note`,
        [employe.id, date, req.body.statut, (req.body.note || '').trim().slice(0, 120)]
      );
    } else if (action === 'effacer') {
      await executer(`DELETE FROM pointages WHERE employe_id = $1 AND date = $2`, [employe.id, date]);
    }
    redirigerRetour(req, res, '/salon/presences');
  } catch (err) { next(err); }
});
