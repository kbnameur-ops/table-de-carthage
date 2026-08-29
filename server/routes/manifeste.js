import { Router } from 'express';
import { manifeste } from '../lib/epinglage.js';

export const manifesteRouter = Router();

/** Les manifestes d'application, un par espace.
 *
 *  Servis par une route plutôt que déposés en fichiers statiques : les
 *  quatre ne diffèrent que par trois champs, et les garder au même endroit
 *  que leur définition évite qu'un nom change d'un côté sans l'autre.
 *
 *  Le type MIME compte : un navigateur qui reçoit `application/json` ignore
 *  purement et simplement le manifeste, sans rien signaler. */
manifesteRouter.get('/manifeste/:espace.webmanifest', (req, res) => {
  const contenu = manifeste(req.params.espace);
  if (!contenu) return res.status(404).json({ erreur: 'Espace inconnu.' });

  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(JSON.stringify(contenu, null, 2));
});
