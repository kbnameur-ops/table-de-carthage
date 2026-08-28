import { query, une, executer } from '../db.js';

/** Une tablée : les clients installés à une table, de leur arrivée à
 *  l'encaissement. C'est l'objet auquel se rattachent les commandes sur
 *  place — y compris celles ajoutées en cours de repas, pour que tout
 *  arrive sur la même addition.
 *
 *  Une commande à emporter n'a jamais de tablée, même passée depuis la
 *  salle : elle suit son propre circuit, avec son heure de retrait. */

const aujourdHui = () => new Date().toISOString().slice(0, 10);

export async function tableParCode(code) {
  if (!code || !/^[0-9a-f]{16}$/.test(code)) return null;
  return (await une(
    `SELECT t.*, s.nom AS service_nom FROM tables_resto t
       JOIN services s ON s.id = t.service_id
      WHERE t.code_qr = $1`,
    [code]
  )) || null;
}

/** La tablée ouverte sur une table donnée, avec son client. */
export async function tableeOuverteSurTable(tableId) {
  return (await une(
    `SELECT tb.*, c.prenom, c.nom AS client_nom, c.telephone_saisi
       FROM tablees tb JOIN clients c ON c.id = tb.client_id
      WHERE tb.table_id = $1 AND tb.statut = 'ouverte'`,
    [tableId]
  )) || null;
}

/** La tablée ouverte d'un client, s'il est attablé quelque part. C'est ce
 *  qui permet à l'espace client de proposer « ajouter à ma table ». */
export async function tableeOuverteDuClient(clientId) {
  if (!clientId) return null;
  return (await une(
    `SELECT tb.*, t.nom AS table_nom, t.code_qr
       FROM tablees tb JOIN tables_resto t ON t.id = tb.table_id
      WHERE tb.client_id = $1 AND tb.statut = 'ouverte'
      ORDER BY tb.ouverte_le DESC LIMIT 1`,
    [clientId]
  )) || null;
}

/** La réservation du jour de ce client sur cette table, s'il en a une :
 *  on rattache alors la tablée à sa réservation plutôt que d'ouvrir une
 *  visite sans lien avec ce qui était prévu. */
async function reservationDuJour(clientId, tableId) {
  return (await une(
    `SELECT id FROM reservations
      WHERE client_id = $1 AND table_id = $2 AND date = $3
        AND statut NOT IN ('annulee','absente')
      ORDER BY heure LIMIT 1`,
    [clientId, tableId, aujourdHui()]
  )) || null;
}

/** Installe un client à une table : reprend la tablée déjà ouverte si
 *  c'est la sienne, en ouvre une sinon. Refuse si la table est occupée
 *  par quelqu'un d'autre — deux additions concurrentes sur une même table
 *  seraient impossibles à démêler au moment de payer. */
export async function ouvrirOuRejoindreTablee(tableId, clientId) {
  const existante = await tableeOuverteSurTable(tableId);
  if (existante) {
    if (existante.client_id === clientId) return { tablee: existante };
    return { erreur: 'table_occupee', tablee: existante };
  }

  const resa = await reservationDuJour(clientId, tableId);
  const creee = await une(
    `INSERT INTO tablees (table_id, client_id, reservation_id, date)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tableId, clientId, resa?.id ?? null, aujourdHui()]
  );
  return { tablee: creee };
}

export async function fermerTablee(tableeId) {
  await executer(
    `UPDATE tablees SET statut = 'fermee', fermee_le = now() WHERE id = $1 AND statut = 'ouverte'`,
    [tableeId]
  );
}

/** Les commandes d'une tablée et le total consommé. Les commandes
 *  annulées ne comptent pas dans l'addition. */
export async function additionDeTablee(tableeId) {
  const commandes = await query(
    `SELECT * FROM commandes WHERE tablee_id = $1 ORDER BY cree_le`, [tableeId]
  );
  const ids = commandes.map(c => c.id);
  const lignes = ids.length
    ? await query(`SELECT * FROM commande_lignes WHERE commande_id = ANY($1::int[])`, [ids])
    : [];

  const parCommande = new Map(ids.map(id => [id, []]));
  for (const l of lignes) parCommande.get(l.commande_id)?.push(l);

  const avecLignes = commandes.map(c => ({ ...c, lignes: parCommande.get(c.id) || [] }));
  const total = avecLignes
    .filter(c => c.statut !== 'annulee')
    .reduce((s, c) => s + c.total_cents, 0);

  return { commandes: avecLignes, total };
}

/** Les tablées d'un jour, pour l'écran « Tables clients » du salon. */
export async function tableesDuJour(date, statut = null) {
  const params = [date];
  let filtre = '';
  if (statut) { params.push(statut); filtre = ` AND tb.statut = $${params.length}`; }

  const tablees = await query(
    `SELECT tb.*, t.nom AS table_nom, t.couverts AS table_couverts,
            c.prenom, c.nom AS client_nom, c.telephone_saisi, c.email,
            r.reference AS reservation_reference, r.couverts AS reservation_couverts
       FROM tablees tb
       JOIN tables_resto t ON t.id = tb.table_id
       JOIN clients c ON c.id = tb.client_id
       LEFT JOIN reservations r ON r.id = tb.reservation_id
      WHERE tb.date = $1${filtre}
      ORDER BY tb.statut, tb.ouverte_le DESC`,
    params
  );
  if (!tablees.length) return [];

  // Les totaux en une requête plutôt qu'une par tablée : l'écran affiche
  // toute la salle d'un service, la boucle se paierait cher.
  const totaux = await query(
    `SELECT tablee_id, COALESCE(SUM(total_cents), 0)::int AS total, COUNT(*)::int AS n
       FROM commandes
      WHERE tablee_id = ANY($1::int[]) AND statut != 'annulee'
      GROUP BY tablee_id`,
    [tablees.map(t => t.id)]
  );
  const parTablee = new Map(totaux.map(t => [t.tablee_id, t]));

  return tablees.map(t => ({
    ...t,
    total: parTablee.get(t.id)?.total ?? 0,
    nbCommandes: parTablee.get(t.id)?.n ?? 0,
  }));
}
