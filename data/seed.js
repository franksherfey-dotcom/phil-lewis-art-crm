const db = require('../database');

const companies = [
  // ── PUZZLE COMPANIES ──
  { name: 'Buffalo Games', type: 'manufacturer', website: 'buffalogames.com', city: 'Buffalo', state: 'NY', category: 'Jigsaw Puzzles', notes: 'One of the largest US puzzle makers. License art directly from artists. Strong market for scenic/immersive art. Contact: licensing@buffalogames.com' },
  { name: 'White Mountain Puzzles', type: 'manufacturer', website: 'whitemountainpuzzles.com', city: 'Conway', state: 'NH', category: 'Jigsaw Puzzles', notes: 'Known for nostalgic and artistic puzzles. Artist-friendly licensing. Great fit for landscape/nature themes.' },
  { name: 'Galison / Mudpuppy', type: 'manufacturer', website: 'galison.com', city: 'New York', state: 'NY', category: 'Puzzles, Stationery, Gifts', notes: 'Design-forward puzzle and gift company. Very open to contemporary/whimsical art. Strong retail presence at major chains.' },
  { name: 'MasterPieces Puzzle Co.', type: 'manufacturer', website: 'masterpiecespuzzle.com', city: 'Tucson', state: 'AZ', category: 'Jigsaw Puzzles', notes: 'Licenses landscape and nature art. Good mid-tier market.' },
  { name: 'Cobble Hill Puzzles', type: 'manufacturer', website: 'cobblehillpuzzles.com', city: 'Calgary', state: 'AB', category: 'Jigsaw Puzzles', notes: 'Canadian puzzle company with strong artistic focus. Nature and whimsical art does well here.' },
  { name: 'Ceaco', type: 'manufacturer', website: 'ceaco.com', city: 'Newton', state: 'MA', category: 'Jigsaw Puzzles', notes: 'Licenses artist collections. Has worked with many independent artists. Colorful/vivid art preferred.' },

  // ── CALENDAR & BOOK PUBLISHERS ──
  { name: 'Lang Companies', type: 'publisher', website: 'lang.com', city: 'Delafield', state: 'WI', category: 'Calendars, Home Decor, Stationery', notes: 'Major calendar publisher. Actively licenses nature and landscape art. One of the best targets for landscape style.' },
  { name: 'Pomegranate Communications', type: 'publisher', website: 'pomegranate.com', city: 'Petaluma', state: 'CA', category: 'Calendars, Art Books, Cards, Puzzles', notes: 'Art-focused publisher. Loves unique artistic voices including psychedelic/surreal. Very artist-friendly licensing program.' },
  { name: 'Sellers Publishing', type: 'publisher', website: 'sellerspublishing.com', city: 'Portland', state: 'ME', category: 'Calendars, Books, Gifts', notes: 'Independent publisher. Licenses art for calendars and books. Nature/landscape themes do well.' },
  { name: 'TF Publishing', type: 'publisher', website: 'tfpublishing.com', city: 'Lakewood', state: 'CO', category: 'Calendars, Planners', notes: 'Growing calendar/planner company. Licenses contemporary art for desk and wall calendars.' },
  { name: 'Graphique de France', type: 'publisher', website: 'graphiqueusa.com', city: 'Boston', state: 'MA', category: 'Calendars, Stationery, Cards', notes: 'Design-forward stationery and calendar company. Strong aesthetic fit for whimsical/artistic work.' },
  { name: 'Andrews McMeel Publishing', type: 'publisher', website: 'andrewsmcmeel.com', city: 'Kansas City', state: 'MO', category: 'Books, Calendars, Cards', notes: 'Major publisher of gift books and calendars. Licenses art collections. Look for their art submission guidelines.' },

  // ── WALL ART & HOME DECOR ──
  { name: 'Wild Apple Graphics', type: 'publisher', website: 'wildapple.com', city: 'Woodstock', state: 'VT', category: 'Art Licensing, Wall Art, Prints', notes: 'One of the top art licensing publishers. They sell licensed art to retailers worldwide. A key target for Phil.' },
  { name: 'Open Road Brands', type: 'manufacturer', website: 'openroadbrands.com', city: 'Eden Prairie', state: 'MN', category: 'Home Decor, Wall Art, Metal Signs', notes: 'Licenses art for home decor and wall products. Nature and landscape themes very relevant.' },
  { name: 'Creative Co-Op', type: 'manufacturer', website: 'creativecoop.com', city: 'Memphis', state: 'TN', category: 'Home Decor, Gifts, Wall Art', notes: 'Wholesale home decor and gifts. Licenses art for prints, pillows, and decorative items.' },
  { name: 'DEMDACO', type: 'manufacturer', website: 'demdaco.com', city: 'Leawood', state: 'KS', category: 'Gifts, Home Decor, Inspirational', notes: 'Premium gift and home decor company. Artist-driven products. Meaningful/nature art does well here.' },
  { name: 'Primitives by Kathy', type: 'manufacturer', website: 'primitivesbykathy.com', city: 'York', state: 'PA', category: 'Home Decor, Signs, Gifts', notes: 'Licenses art for rustic/nature-themed home decor products.' },

  // ── GREETING CARDS ──
  { name: 'Recycled Paper Greetings', type: 'publisher', website: 'recycledpaper.com', city: 'Chicago', state: 'IL', category: 'Greeting Cards', notes: 'One of the most artist-friendly card companies. Actively seeks unique art styles including whimsical/psychedelic.' },
  { name: "Leanin' Tree", type: 'publisher', website: 'leanintree.com', city: 'Boulder', state: 'CO', category: 'Greeting Cards, Gifts', notes: "Nature and outdoors focused card company. Phil's landscapes would be a strong fit." },
  { name: 'Portal Publications', type: 'publisher', website: 'portalgreetings.com', city: 'Novato', state: 'CA', category: 'Greeting Cards, Posters', notes: 'Art-forward card and poster publisher. Known for working with distinctive artistic voices.' },
  { name: 'Oatmeal Studios', type: 'publisher', website: 'oatmealstudios.com', city: 'Bradford', state: 'VT', category: 'Greeting Cards', notes: 'Boutique card company with strong artistic sensibility.' },

  // ── STATIONERY / JOURNALS / GIFTS ──
  { name: 'Peter Pauper Press', type: 'publisher', website: 'peterpauper.com', city: 'White Plains', state: 'NY', category: 'Journals, Stationery, Gift Books', notes: 'Licenses art for journals, notebooks, and gift books. Artistic/decorative styles do very well here. Worth a strong pitch.' },
  { name: 'Compendium Inc.', type: 'publisher', website: 'compendium.com', city: 'Seattle', state: 'WA', category: 'Inspirational Gifts, Books, Stationery', notes: 'Inspirational gift and stationery company. Nature and meaningful themes align well.' },

  // ── FABRIC / TEXTILE ──
  { name: 'Windham Fabrics', type: 'manufacturer', website: 'windhamfabrics.com', city: 'New York', state: 'NY', category: 'Quilting Fabric', notes: 'Premier quilting fabric company. Licenses artist collections for fabric prints. Nature/landscape art translates well to fabric.' },
  { name: 'Robert Kaufman Fabrics', type: 'manufacturer', website: 'robertkaufman.com', city: 'Los Angeles', state: 'CA', category: 'Quilting Fabric, Apparel Fabric', notes: 'One of the largest fabric licensors. Actively seeks artists with distinctive styles.' },
  { name: 'Northcott Fabrics', type: 'manufacturer', website: 'northcott.com', city: 'Toronto', state: 'ON', category: 'Quilting Fabric', notes: 'Canadian fabric company, very artist-friendly. Strong nature/landscape catalog.' },
  { name: 'Benartex Fabrics', type: 'manufacturer', website: 'benartex.com', city: 'New York', state: 'NY', category: 'Quilting Fabric', notes: 'Licenses collections from independent artists. Colorful and artistic styles are their focus.' },
];

const ins = db.prepare('INSERT INTO companies (name, type, website, city, state, category, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
let count = 0;
companies.forEach(c => {
  ins.run(c.name, c.type, c.website || '', c.city || '', c.state || '', c.category || '', c.notes || '', 'prospect');
  count++;
});
console.log('Seeded', count, 'companies');
