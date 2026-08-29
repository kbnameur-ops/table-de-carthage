-- ═══════════════════════════════════════════════════════════
-- La Table de Carthage — schéma Postgres (Vercel Postgres / Neon)
-- Les montants sont en centimes d'euro (entiers) : jamais de
-- flottant sur de l'argent, 0.1 + 0.2 ne fait pas 0.3.
-- Les dates métier (réservation, retrait, naissance...) restent en
-- texte ISO 'YYYY-MM-DD' / 'HH:MM' plutôt qu'en DATE/TIME natifs :
-- elles sont comparées et affichées comme de simples chaînes partout
-- dans le code JS (ex. date >= aujourdHui), et un DATE natif renvoyé
-- par le pilote sous forme d'objet aurait fallu retraiter à chaque
-- lecture. Seules les horodatages purement techniques (cree_le,
-- expire_le, le) sont en TIMESTAMPTZ.
-- ═══════════════════════════════════════════════════════════

-- ── La carte ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug      TEXT    NOT NULL UNIQUE,
  nom       TEXT    NOT NULL,
  accroche  TEXT    NOT NULL DEFAULT '',
  position  INTEGER NOT NULL DEFAULT 0,
  visible   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS plats (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  categorie_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  nom          TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  prix_cents   INTEGER NOT NULL CHECK (prix_cents >= 0),
  photo        TEXT,                          -- URL Vercel Blob (ou chemin local en dev)
  vegetarien   BOOLEAN NOT NULL DEFAULT false,
  signature    BOOLEAN NOT NULL DEFAULT false,
  a_emporter   BOOLEAN NOT NULL DEFAULT true,
  position     INTEGER NOT NULL DEFAULT 0,
  visible      BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_plats_categorie ON plats(categorie_id, position);

-- ── Services et capacité ──────────────────────────────────
-- jours : chaînes de chiffres 1..7 (1 = lundi), ex. '123456' = lundi au samedi
CREATE TABLE IF NOT EXISTS services (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom            TEXT    NOT NULL,
  jours          TEXT    NOT NULL,
  debut          TEXT    NOT NULL,            -- 'HH:MM'
  fin            TEXT    NOT NULL,            -- 'HH:MM'
  tables_total   INTEGER NOT NULL CHECK (tables_total   >= 0),
  couverts_total INTEGER NOT NULL CHECK (couverts_total >= 0),
  pas_minutes    INTEGER NOT NULL DEFAULT 30 CHECK (pas_minutes > 0),
  actif          BOOLEAN NOT NULL DEFAULT true,
  position       INTEGER NOT NULL DEFAULT 0
);

-- Fermetures exceptionnelles (congés, jour férié, privatisation)
CREATE TABLE IF NOT EXISTS fermetures (
  id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date   TEXT NOT NULL UNIQUE,                -- 'YYYY-MM-DD'
  motif  TEXT NOT NULL DEFAULT ''
);

-- ── Clients ───────────────────────────────────────────────
-- L'accès se fait par téléphone + date de naissance. Le téléphone
-- est stocké normalisé (chiffres uniquement) pour que 06 12 34 56 78,
-- 0612345678 et +33612345678 désignent bien la même personne.
CREATE TABLE IF NOT EXISTS clients (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prenom           TEXT NOT NULL,
  nom              TEXT NOT NULL,
  email            TEXT NOT NULL,
  telephone        TEXT NOT NULL UNIQUE,      -- normalisé
  telephone_saisi  TEXT NOT NULL,             -- tel que tapé, pour l'affichage
  date_naissance   TEXT NOT NULL,             -- 'YYYY-MM-DD'
  notes            TEXT NOT NULL DEFAULT '',
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

-- ── Réservations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reference   TEXT    NOT NULL UNIQUE,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id  INTEGER REFERENCES services(id) ON DELETE SET NULL,
  date        TEXT    NOT NULL,               -- 'YYYY-MM-DD'
  heure       TEXT    NOT NULL,               -- 'HH:MM'
  couverts    INTEGER NOT NULL CHECK (couverts > 0),
  motif       TEXT    NOT NULL DEFAULT 'Réservation',
  message     TEXT    NOT NULL DEFAULT '',
  statut      TEXT    NOT NULL DEFAULT 'en_attente'
              CHECK (statut IN ('en_attente','confirmee','honoree','annulee','absente')),
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resa_date ON reservations(date, heure);
CREATE INDEX IF NOT EXISTS idx_resa_client ON reservations(client_id, date);

-- ── Commandes à emporter ──────────────────────────────────
CREATE TABLE IF NOT EXISTS commandes (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reference   TEXT    NOT NULL UNIQUE,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date        TEXT    NOT NULL,               -- retrait : 'YYYY-MM-DD'
  heure       TEXT    NOT NULL,               -- retrait : 'HH:MM'
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  message     TEXT    NOT NULL DEFAULT '',
  statut      TEXT    NOT NULL DEFAULT 'en_attente'
              CHECK (statut IN ('en_attente','confirmee','prete','retiree','annulee')),
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cmd_date ON commandes(date, heure);
CREATE INDEX IF NOT EXISTS idx_cmd_client ON commandes(client_id, date);

-- Le nom et le prix sont recopiés : une commande passée doit rester
-- lisible même si le plat est renommé ou retiré de la carte ensuite.
CREATE TABLE IF NOT EXISTS commande_lignes (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  plat_id     INTEGER REFERENCES plats(id) ON DELETE SET NULL,
  nom         TEXT    NOT NULL,
  prix_cents  INTEGER NOT NULL CHECK (prix_cents >= 0),
  quantite    INTEGER NOT NULL CHECK (quantite > 0)
);
CREATE INDEX IF NOT EXISTS idx_lignes_commande ON commande_lignes(commande_id);

-- ── Comptes du salon ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  mot_de_passe  TEXT NOT NULL,                -- scrypt : sel:empreinte
  nom           TEXT NOT NULL DEFAULT '',
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Sessions ──────────────────────────────────────────────
-- Une ligne par navigateur, dès la première visite (role='invite').
-- La connexion client ou salon met à jour role/sujet_id sur la même ligne :
-- le jeton CSRF reste valable, pas besoin de le régénérer à la connexion.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,
  role       TEXT    NOT NULL DEFAULT 'invite' CHECK (role IN ('invite','client','admin')),
  sujet_id   INTEGER,
  csrf_token TEXT    NOT NULL,
  expire_le  TIMESTAMPTZ NOT NULL,
  cree_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire_le);

-- ── Anti-force brute et anti-abus ──────────────────────────
CREATE TABLE IF NOT EXISTS tentatives (
  id  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cle TEXT NOT NULL,                          -- 'client:0612345678' ou 'admin:ip'
  le  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tentatives_cle ON tentatives(cle, le);

-- ── Réglages ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reglages (
  cle    TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════
-- v2 — Capacité par tables réelles, et gestion d'équipe
-- Ces blocs sont idempotents (IF NOT EXISTS) : le même fichier
-- s'applique à une base neuve comme à une base déjà en service.
-- ═══════════════════════════════════════════════════════════

-- ── Les tables de la salle ─────────────────────────────────
-- Rattachées à un service : la salle peut être découpée autrement
-- le midi et le soir (terrasse fermée, tables rapprochées...).
CREATE TABLE IF NOT EXISTS tables_resto (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  nom        TEXT    NOT NULL,                    -- 'T1', 'Terrasse 3'
  couverts   INTEGER NOT NULL CHECK (couverts > 0),
  position   INTEGER NOT NULL DEFAULT 0,
  actif      BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_tables_service ON tables_resto(service_id, position);

-- Une réservation occupe une table précise, assignée à la confirmation.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS table_id INTEGER REFERENCES tables_resto(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_resa_table ON reservations(table_id, date, heure);

-- L'autre façon d'occuper une table : le salon la coche occupée
-- (client sans réservation, table réservée au personnel, service en cours).
CREATE TABLE IF NOT EXISTS occupations (
  id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_id  INTEGER NOT NULL REFERENCES tables_resto(id) ON DELETE CASCADE,
  date      TEXT    NOT NULL,                     -- 'YYYY-MM-DD'
  heure     TEXT    NOT NULL,                     -- 'HH:MM'
  couverts  INTEGER NOT NULL DEFAULT 0 CHECK (couverts >= 0),
  note      TEXT    NOT NULL DEFAULT '',
  cree_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (table_id, date, heure)
);
CREATE INDEX IF NOT EXISTS idx_occupations_jour ON occupations(date, heure);

-- La capacité vient désormais de la somme des tables : ces deux colonnes
-- ne sont plus lues nulle part, mais restent en base pour ne pas perdre
-- la configuration d'origine d'un service déjà créé.
ALTER TABLE services ALTER COLUMN tables_total   SET DEFAULT 0;
ALTER TABLE services ALTER COLUMN couverts_total SET DEFAULT 0;

-- ── Équipe : planning prévisionnel et présence réelle ──────
CREATE TABLE IF NOT EXISTS employes (
  id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prenom    TEXT    NOT NULL,
  nom       TEXT    NOT NULL,
  poste     TEXT    NOT NULL DEFAULT '',          -- 'Salle', 'Cuisine', 'Plonge'
  telephone TEXT    NOT NULL DEFAULT '',
  email     TEXT    NOT NULL DEFAULT '',
  actif     BOOLEAN NOT NULL DEFAULT true,
  cree_le   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un shift prévu. Une même personne peut en avoir deux le même jour
-- (coupure midi/soir), d'où l'absence de contrainte d'unicité par date.
CREATE TABLE IF NOT EXISTS plannings (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employe_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,                    -- 'YYYY-MM-DD'
  debut      TEXT    NOT NULL,                    -- 'HH:MM'
  fin        TEXT    NOT NULL,                    -- 'HH:MM'
  note       TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_plannings_jour ON plannings(date, debut);
CREATE INDEX IF NOT EXISTS idx_plannings_employe ON plannings(employe_id, date);

-- La présence constatée, saisie en un clic depuis le planning du jour.
-- Séparée du planning : on veut pouvoir comparer prévu et réalisé, et
-- pointer quelqu'un qui n'était pas prévu.
CREATE TABLE IF NOT EXISTS pointages (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employe_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  arrivee    TEXT,                                -- 'HH:MM', NULL tant qu'absent
  depart     TEXT,
  statut     TEXT    NOT NULL DEFAULT 'present'
             CHECK (statut IN ('present','absent','conge','maladie')),
  note       TEXT    NOT NULL DEFAULT '',
  UNIQUE (employe_id, date)
);
CREATE INDEX IF NOT EXISTS idx_pointages_jour ON pointages(date);

-- ── Notifications du salon ─────────────────────────────────
-- Un événement à signaler à l'équipe : nouvelle réservation, nouvelle
-- commande, annulation par un client. Écrites au moment où l'événement se
-- produit, marquées lues depuis le salon. `lien` évite de reconstruire
-- l'URL de destination à l'affichage.
CREATE TABLE IF NOT EXISTS notifications (
  id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type    TEXT    NOT NULL
          CHECK (type IN ('reservation','commande','annulation_reservation','annulation_commande')),
  titre   TEXT    NOT NULL,
  detail  TEXT    NOT NULL DEFAULT '',
  lien    TEXT    NOT NULL DEFAULT '/salon',
  lue     BOOLEAN NOT NULL DEFAULT false,
  cree_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Le badge compte les non-lues à chaque page du salon : l'index porte sur
-- `lue` en premier pour que ce COUNT reste immédiat quand l'historique grossit.
CREATE INDEX IF NOT EXISTS idx_notifications_lue ON notifications(lue, cree_le DESC);

-- ═══════════════════════════════════════════════════════════
-- v3 — Service à table : QR code, tablées, commandes sur place
-- ═══════════════════════════════════════════════════════════

-- Le code du QR collé sur la table. Aléatoire et non devinable : avec
-- l'identifiant de la table, n'importe qui pourrait ouvrir une tablée sur
-- une table qu'il n'occupe pas.
ALTER TABLE tables_resto ADD COLUMN IF NOT EXISTS code_qr TEXT;
UPDATE tables_resto SET code_qr = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) WHERE code_qr IS NULL;
ALTER TABLE tables_resto ALTER COLUMN code_qr SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_code_qr ON tables_resto(code_qr);

-- Une tablée : des clients installés à une table, du moment où ils s'y
-- posent jusqu'à l'encaissement. C'est à elle que se rattachent les
-- commandes sur place, y compris celles ajoutées en cours de repas.
CREATE TABLE IF NOT EXISTS tablees (
  id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_id       INTEGER NOT NULL REFERENCES tables_resto(id) ON DELETE CASCADE,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
  date           TEXT    NOT NULL,            -- 'YYYY-MM-DD', pour les vues par jour
  statut         TEXT    NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte','fermee')),
  ouverte_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  fermee_le      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tablees_jour ON tablees(date, statut);
CREATE INDEX IF NOT EXISTS idx_tablees_client ON tablees(client_id, statut);

-- Une table ne peut porter qu'une tablée ouverte à la fois : sans cette
-- garantie, deux clients scannant le même QR ouvriraient deux additions
-- concurrentes sur la même table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tablee_ouverte_unique
  ON tablees(table_id) WHERE statut = 'ouverte';

-- Une commande est soit à emporter, soit servie à une tablée. Les deux ne
-- se mélangent jamais : une commande à emporter reste détachée de toute
-- table, même passée depuis la salle.
ALTER TABLE commandes ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'emporter';
ALTER TABLE commandes ADD COLUMN IF NOT EXISTS tablee_id INTEGER REFERENCES tablees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_commandes_tablee ON commandes(tablee_id);

DO $$ BEGIN
  ALTER TABLE commandes ADD CONSTRAINT commandes_type_coherent CHECK (
    (type = 'emporter'  AND tablee_id IS NULL) OR
    (type = 'sur_place' AND tablee_id IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════
-- v4 — Cagnotte de fidélité, encaissement, comptes serveurs
-- ═══════════════════════════════════════════════════════════

-- ── La cagnotte ────────────────────────────────────────────
-- Le solde est une colonne dénormalisée, tenue dans la même transaction
-- que le mouvement qui la fait bouger. Un SUM() sur l'historique donnerait
-- la même valeur, mais ne permettrait pas au CHECK ci-dessous de refuser
-- un découvert : deux transferts simultanés pourraient chacun lire un
-- solde suffisant et vider la cagnotte deux fois.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cagnotte_cents INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_cagnotte_positive CHECK (cagnotte_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- L'historique, en mouvements signés. Le client doit pouvoir répondre à
-- « d'où vient ce solde ? », et le restaurant à « qui a envoyé quoi ».
CREATE TABLE IF NOT EXISTS fidelite_mouvements (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  delta_cents     INTEGER NOT NULL CHECK (delta_cents <> 0),
  type            TEXT    NOT NULL CHECK (type IN
                    ('gain','depense','transfert_envoye','transfert_recu','ajustement')),
  commande_id     INTEGER REFERENCES commandes(id) ON DELETE SET NULL,
  contrepartie_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  libelle         TEXT    NOT NULL DEFAULT '',
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fidelite_client ON fidelite_mouvements(client_id, cree_le DESC);

-- Un gain et un seul par commande. C'est ce qui rend l'encaissement
-- rejouable sans risque : un double clic sur « encaisser », ou une
-- requête réémise par un réseau capricieux, ne crédite pas deux fois.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fidelite_gain_unique
  ON fidelite_mouvements(commande_id) WHERE type = 'gain';

-- Ce que la cagnotte a payé sur cette commande. Nécessaire pour que le
-- gain porte sur ce qui a réellement été payé, et non sur le montant
-- affiché : sans quoi la cagnotte se regénérerait elle-même.
ALTER TABLE commandes ADD COLUMN IF NOT EXISTS remise_cagnotte_cents INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE commandes ADD CONSTRAINT commandes_remise_positive CHECK (remise_cagnotte_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Le statut 'encaissee' rejoint la liste : jusqu'ici une commande à
-- emporter s'arrêtait à 'retiree', et une commande sur place n'avait pas
-- d'état final du tout. C'est cet état qui déclenche le gain.
--
-- La contrainte elle-même est déclarée plus bas, dans le bloc v5 : deux
-- blocs qui la redéfinissent chacun de leur côté se contredisent, et le
-- premier fait échouer tout le fichier dès qu'une ligne porte un statut
-- que lui seul ignore. Un seul endroit fait foi, le dernier.

-- ── Comptes serveurs ───────────────────────────────────────
-- Un employé peut recevoir un accès à l'interface de prise de commande.
-- L'identifiant est court et sans arobase : il se tape au clavier tactile
-- d'une tablette, en salle, entre deux services.
ALTER TABLE employes ADD COLUMN IF NOT EXISTS identifiant   TEXT;
ALTER TABLE employes ADD COLUMN IF NOT EXISTS mot_de_passe  TEXT;
ALTER TABLE employes ADD COLUMN IF NOT EXISTS acces_service BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employes_identifiant
  ON employes(identifiant) WHERE identifiant IS NOT NULL;

-- Le rôle 'serveur' rejoint les sessions.
DO $$ BEGIN
  ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_role_check;
  ALTER TABLE sessions ADD CONSTRAINT sessions_role_check CHECK (role IN
    ('invite','client','admin','serveur'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Le taux est un réglage et non une constante : 10 % est un choix
-- commercial, qui se révise sans redéploiement.
INSERT INTO reglages (cle, valeur) VALUES ('fidelite_taux_pourcent', '10')
  ON CONFLICT (cle) DO NOTHING;

-- Un transfert de cagnotte est un mouvement d'argent entre deux comptes :
-- le salon doit le voir passer comme il voit passer une commande.
DO $$ BEGIN
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
    ('reservation','commande','annulation_reservation','annulation_commande','fidelite'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════
-- v5 — Cuisine : cycle de vie d'une commande, accès dédié
-- ═══════════════════════════════════════════════════════════

-- Deux états s'intercalent entre la prise de commande et le plat prêt.
-- 'confirmee' devient donc « nouvelle, pas encore vue » du point de vue de
-- la cuisine. 'vue' dit qu'elle a été lue, 'en_preparation' qu'elle est
-- au feu. Sans ces deux-là, une commande restait « confirmée » de son
-- enregistrement jusqu'à sa sortie, et personne en salle ne savait où elle
-- en était.
DO $$ BEGIN
  ALTER TABLE commandes DROP CONSTRAINT IF EXISTS commandes_statut_check;
  ALTER TABLE commandes ADD CONSTRAINT commandes_statut_check CHECK (statut IN (
    'en_attente','confirmee','vue','en_preparation','prete',
    'retiree','encaissee','annulee'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- L'horodatage de chaque passage, pour afficher un temps d'attente réel
-- plutôt que l'ancienneté de la commande : ce qui compte au passe, c'est
-- depuis combien de temps le plat est au feu, ou prêt et non servi.
ALTER TABLE commandes ADD COLUMN IF NOT EXISTS vue_le           TIMESTAMPTZ;
ALTER TABLE commandes ADD COLUMN IF NOT EXISTS preparation_le   TIMESTAMPTZ;
ALTER TABLE commandes ADD COLUMN IF NOT EXISTS prete_le         TIMESTAMPTZ;

-- L'accès à l'écran de cuisine se donne comme celui de la salle, sur la
-- fiche employé. Les deux sont indépendants : un chef de rang peut avoir
-- les deux, un commis seulement la cuisine.
ALTER TABLE employes ADD COLUMN IF NOT EXISTS acces_cuisine BOOLEAN NOT NULL DEFAULT false;
