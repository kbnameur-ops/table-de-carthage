/* ═══════════════════════════════════════════════════════════
   La Table de Carthage — carte du restaurant
   Une seule source de vérité : modifier ici met à jour
   l'affichage du site ET les données structurées (SEO).
   ═══════════════════════════════════════════════════════════ */

const MENU = [
  {
    id: 'couscous',
    name: 'Couscous',
    tagline: 'Semoule roulée à la main, bouillon de légumes du jour',
    items: [
      { name: 'Couscous Royal',        desc: "Agneau, merguez et poulet réunis dans le même plat", price: 20,    star: true },
      { name: "Couscous à l'Agneau",   desc: "Épaule confite au bouillon safrané",                 price: 16.50 },
      { name: 'Couscous au Merguez',   desc: "Merguez grillées à la braise",                        price: 15.50 },
      { name: 'Couscous au Poulet',    desc: "Cuisse dorée, légumes fondants",                      price: 15.50 },
      { name: 'Couscous Végétarien',   desc: "Sept légumes, pois chiches, harissa à part",          price: 13,    veg: true }
    ]
  },
  {
    id: 'pates',
    name: 'Pâtes',
    tagline: 'Nos pâtes à la tunisienne, sauce longuement mijotée',
    items: [
      { name: 'Pâtes au Poulet',        desc: "Sauce rouge légèrement relevée",            price: 15 },
      { name: "Pâtes à l'Agneau",       desc: "Morceaux d'agneau mijotés au tabil",        price: 16.50 },
      { name: 'Pâtes aux Fruits de Mer',desc: "Crevettes, calamars, parfum d'ail et persil",price: 18 }
    ]
  },
  {
    id: 'ojja',
    name: 'Ojja',
    tagline: 'Servie brûlante dans sa poêle, œufs coulants',
    items: [
      { name: 'Ojja Nature',        desc: "Tomate, poivron, harissa, œufs",       price: 12, veg: true },
      { name: 'Ojja Merguez',       desc: "Merguez maison tranchées",             price: 14 },
      { name: 'Ojja Fruits de Mer', desc: "Crevettes et calamars du jour",        price: 16, star: true }
    ]
  },
  {
    id: 'kafteji',
    name: 'Kafteji',
    tagline: 'Légumes frits puis hachés au couteau, servis chauds',
    items: [
      { name: 'Kafteji Nature',   desc: "Courgette, poivron, pomme de terre, œuf", price: 12, veg: true },
      { name: 'Kafteji Escalope', desc: "Escalope de poulet grillée",              price: 14 },
      { name: 'Kafteji Merguez',  desc: "Merguez de la maison",                     price: 14 },
      { name: 'Kafteji Foie',     desc: "Foie de veau poêlé au carvi",              price: 14 }
    ]
  },
  {
    id: 'grillades',
    name: 'Grillades',
    tagline: 'Au charbon de bois, servies avec frites ou salade',
    items: [
      { name: 'Grillade Mixte',    desc: "Côtes d'agneau, merguez, foie et escalope de poulet", price: 22, star: true },
      { name: "Grillade d'Agneau", desc: "Côtes d'agneau marinées au tabil",                     price: 21 },
      { name: 'Poisson Grillé',    desc: "Pêche du jour, huile d'olive et citron",               price: 19 },
      { name: 'Grillade Merguez',  desc: "Merguez maison à la braise",                            price: 16 },
      { name: 'Grillade Escalope', desc: "Escalope de poulet marinée",                            price: 16 }
    ]
  },
  {
    id: 'divers',
    name: 'Divers',
    tagline: 'Les classiques de la maison',
    items: [
      { name: 'Mloukhia',           desc: "Poudre de corète mijotée 7 h avec son veau", price: 16.50, star: true },
      { name: 'Kamounia',           desc: "Ragoût au cumin, longuement mijoté",          price: 16 },
      { name: 'Assiette Tunisienne',desc: "Salade méchouia, thon, œuf, olives, câpres",  price: 12 },
      { name: 'Assiette de Frites', desc: "Frites maison",                                price: 4, veg: true }
    ]
  },
  {
    id: 'desserts',
    name: 'Desserts',
    tagline: 'Douceurs de Nabeul, de Sfax et de Tunis',
    items: [
      { name: 'Assidet Zgougou',      desc: "Crème de graines de pin d'Alep, crème vanille", price: 6, veg: true, star: true },
      { name: 'Bouza',                desc: "Crème de sorgho aux fruits secs",                price: 7, veg: true },
      { name: 'Jwajem',               desc: "Douceur traditionnelle au miel",                 price: 6, veg: true },
      { name: 'Pâtisserie Tunisienne',desc: "Assortiment du jour : makroud, baklawa, kaak",   price: 6, veg: true }
    ]
  }
];
