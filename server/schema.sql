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
