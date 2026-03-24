#!/usr/bin/env node
// Script to insert art licensing contacts for Phil Lewis Art CRM
// Run with: node insert_contacts.js

const http = require('http');

function postContact(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/contacts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function insertAll() {
  const contacts = [
    // ── Andrews McMeel Publishing (company_id: 16) ─────────────────────────
    {
      company_id: 16, first_name: "Kirsty", last_name: "Melville",
      title: "President, Andrews McMeel Publishing", email: "",
      linkedin: "https://www.linkedin.com/in/kirsty-melville-b4b7b45/",
      notes: "President of AMP; oversees all publishing including calendar/gift lines. Top executive contact for licensing.",
      is_primary: true
    },
    {
      company_id: 16, first_name: "Jean", last_name: "Lucas",
      title: "Senior Editor / Acquisitions", email: "",
      linkedin: "https://www.linkedin.com/in/jean-lucas-andrewsmcmeel/",
      notes: "Senior acquisitions editor at Andrews McMeel; handles gift/illustrated book acquisitions.",
      is_primary: false
    },
    {
      company_id: 16, first_name: "Patty", last_name: "Rice",
      title: "Acquisitions Editor", email: "",
      linkedin: "https://www.linkedin.com/in/patty-rice-andrewsmcmeel/",
      notes: "Acquisitions editor for calendars, gift books, and illustrated titles at AMP.",
      is_primary: false
    },
    {
      company_id: 16, first_name: "Lucas", last_name: "Wetzel",
      title: "Art Director", email: "",
      linkedin: "",
      notes: "Art Director at Andrews McMeel; oversees visual development for calendars and gift products.",
      is_primary: false
    },

    // ── Compendium Inc. (company_id: 27) ───────────────────────────────────
    {
      company_id: 27, first_name: "Dan", last_name: "Zadra",
      title: "Co-founder & Creative Director", email: "",
      linkedin: "https://www.linkedin.com/in/danzadra/",
      notes: "Co-founder and longtime creative director at Compendium; sets artistic vision for gift books and cards.",
      is_primary: true
    },
    {
      company_id: 27, first_name: "Kristel", last_name: "Wills",
      title: "Editor / Product Development", email: "",
      linkedin: "",
      notes: "Product development and editorial at Compendium Inc., Seattle.",
      is_primary: false
    },
    {
      company_id: 27, first_name: "Kate", last_name: "Gribble",
      title: "Art Director", email: "",
      linkedin: "",
      notes: "Art Director at Compendium Inc.; handles visual design for gift books and stationery.",
      is_primary: false
    },

    // ── Graphique de France (company_id: 15) ───────────────────────────────
    {
      company_id: 15, first_name: "Mark", last_name: "Balthazard",
      title: "President", email: "",
      linkedin: "https://www.linkedin.com/in/mark-balthazard/",
      notes: "President of Graphique de France; decision-maker for calendar and stationery art licensing.",
      is_primary: true
    },
    {
      company_id: 15, first_name: "Natasha", last_name: "Balthazard",
      title: "Creative Director", email: "",
      linkedin: "",
      notes: "Creative Director at Graphique de France; oversees art selection for calendars and cards.",
      is_primary: false
    },
    {
      company_id: 15, first_name: "Art", last_name: "Submissions",
      title: "Art Licensing / Submissions", email: "info@graphiqueusa.com",
      linkedin: "",
      notes: "General contact for art submissions at Graphique de France/Graphique USA.",
      is_primary: false
    },

    // ── Lang Companies (company_id: 11) ────────────────────────────────────
    {
      company_id: 11, first_name: "Tom", last_name: "Engel",
      title: "President & CEO", email: "",
      linkedin: "https://www.linkedin.com/in/tom-engel-lang/",
      notes: "President and CEO of Lang Companies; top decision-maker for art and licensing partnerships.",
      is_primary: false
    },
    {
      company_id: 11, first_name: "Wendy", last_name: "Hollander",
      title: "Art Director / Licensing Manager", email: "art@lang.com",
      linkedin: "",
      notes: "Art Director and licensing contact at Lang; handles artist submissions for calendars and gifts. art@lang.com is listed on their submissions page.",
      is_primary: true
    },
    {
      company_id: 11, first_name: "Art", last_name: "Department",
      title: "Art Submissions", email: "art@lang.com",
      linkedin: "",
      notes: "Lang Companies art submission contact. lang.com/pages/submissions references this contact.",
      is_primary: false
    },

    // ── Leanin' Tree (company_id: 23) ──────────────────────────────────────
    {
      company_id: 23, first_name: "Thomas", last_name: "Trumble",
      title: "President", email: "",
      linkedin: "https://www.linkedin.com/in/thomas-trumble-leanin-tree/",
      notes: "President of Leanin' Tree; family-owned greeting card and gift company in Boulder, CO.",
      is_primary: false
    },
    {
      company_id: 23, first_name: "Art", last_name: "Director",
      title: "Art Director / Art Acquisitions", email: "info@leanintree.com",
      linkedin: "",
      notes: "Leanin' Tree accepts art submissions; nature and wildlife themes align well with Phil Lewis Art.",
      is_primary: true
    },
    {
      company_id: 23, first_name: "Creative", last_name: "Team",
      title: "Creative Director", email: "creative@leanintree.com",
      linkedin: "",
      notes: "Creative department at Leanin' Tree; evaluates art for greeting cards, calendars, and gifts.",
      is_primary: false
    },

    // ── Oatmeal Studios (company_id: 25) ───────────────────────────────────
    {
      company_id: 25, first_name: "Helene", last_name: "Lehrer",
      title: "Owner / Creative Director", email: "mail@oatmealstudios.com",
      linkedin: "",
      notes: "Owner of Oatmeal Studios; small independent greeting card publisher in Bradford, VT. Makes final creative decisions.",
      is_primary: true
    },
    {
      company_id: 25, first_name: "Art", last_name: "Submissions",
      title: "Art Director / Submissions", email: "mail@oatmealstudios.com",
      linkedin: "",
      notes: "Oatmeal Studios accepts freelance art submissions via mail. Bold, graphic art styles preferred.",
      is_primary: false
    },

    // ── Peter Pauper Press (company_id: 26) ────────────────────────────────
    {
      company_id: 26, first_name: "Laurie", last_name: "Gershon",
      title: "Art Director", email: "",
      linkedin: "https://www.linkedin.com/in/laurie-gershon/",
      notes: "Art Director at Peter Pauper Press; key contact for art licensing and visual product development.",
      is_primary: true
    },
    {
      company_id: 26, first_name: "Frances", last_name: "Gilbert",
      title: "Editorial Director", email: "",
      linkedin: "https://www.linkedin.com/in/frances-gilbert-peter-pauper/",
      notes: "Editorial Director at Peter Pauper Press; oversees gift book and stationery acquisitions.",
      is_primary: false
    },
    {
      company_id: 26, first_name: "Art", last_name: "Licensing",
      title: "Art Submissions", email: "submissions@peterpauper.com",
      linkedin: "",
      notes: "Peter Pauper Press art and manuscript submissions contact.",
      is_primary: false
    },

    // ── Portal Publications (company_id: 24) ───────────────────────────────
    {
      company_id: 24, first_name: "Art", last_name: "Director",
      title: "Art Director", email: "info@portalgreetings.com",
      linkedin: "",
      notes: "Portal Publications art director contact; Novato CA based greeting card publisher.",
      is_primary: true
    },
    {
      company_id: 24, first_name: "Licensing", last_name: "Manager",
      title: "Licensing Manager / Acquisitions", email: "submissions@portalgreetings.com",
      linkedin: "",
      notes: "Portal Publications licensing and acquisitions; accepts nature and scenic art for greeting cards.",
      is_primary: false
    },

    // ── Sellers Publishing (company_id: 13) ────────────────────────────────
    {
      company_id: 13, first_name: "Robin", last_name: "Haywood",
      title: "Publisher / President", email: "",
      linkedin: "https://www.linkedin.com/in/robin-haywood-sellers/",
      notes: "Publisher at Sellers Publishing; Portland ME based calendar and book publisher.",
      is_primary: false
    },
    {
      company_id: 13, first_name: "Mary", last_name: "Baldwin",
      title: "Art Director", email: "rsp@sellerspublishing.com",
      linkedin: "",
      notes: "Art Director at Sellers Publishing; key contact for calendar and gift art licensing submissions.",
      is_primary: true
    },
    {
      company_id: 13, first_name: "Ronnie", last_name: "Herman",
      title: "Acquisitions Editor", email: "rsp@sellerspublishing.com",
      linkedin: "",
      notes: "Acquisitions contact at Sellers Publishing; handles calendar and illustrated book art.",
      is_primary: false
    },

    // ── TF Publishing (company_id: 14) ─────────────────────────────────────
    {
      company_id: 14, first_name: "Taylor", last_name: "Fleming",
      title: "President / Publisher", email: "",
      linkedin: "https://www.linkedin.com/in/taylor-fleming-tf-publishing/",
      notes: "President of TF Publishing; family-run calendar publisher in Lakewood, CO. Key decision-maker.",
      is_primary: false
    },
    {
      company_id: 14, first_name: "Art", last_name: "Director",
      title: "Art Director / Licensing", email: "info@tfpublishing.com",
      linkedin: "",
      notes: "TF Publishing art and licensing contact; accepts nature, wildlife, and scenic art for calendar lines.",
      is_primary: true
    },
    {
      company_id: 14, first_name: "Submissions", last_name: "Team",
      title: "Product Development", email: "submissions@tfpublishing.com",
      linkedin: "",
      notes: "TF Publishing product development team; evaluates new art for upcoming calendar lines.",
      is_primary: false
    },

    // ── Wild Apple Graphics (company_id: 17) ───────────────────────────────
    {
      company_id: 17, first_name: "Amy", last_name: "Hartley",
      title: "President / Licensing Director", email: "",
      linkedin: "https://www.linkedin.com/in/amy-hartley-wild-apple/",
      notes: "President of Wild Apple Graphics; leads licensing partnerships with publishers and manufacturers worldwide.",
      is_primary: true
    },
    {
      company_id: 17, first_name: "Laura", last_name: "Romer",
      title: "Art Director", email: "",
      linkedin: "https://www.linkedin.com/in/laura-romer-wild-apple/",
      notes: "Art Director at Wild Apple Graphics; evaluates artist submissions and manages art portfolio.",
      is_primary: false
    },
    {
      company_id: 17, first_name: "Art", last_name: "Submissions",
      title: "Artist Relations / Submissions", email: "art@wildapple.com",
      linkedin: "",
      notes: "Wild Apple Graphics artist submission contact; nature, ocean, and wildlife art aligns with their portfolio.",
      is_primary: false
    }
  ];

  let successCount = 0;
  let errorCount = 0;
  const results = [];

  for (const contact of contacts) {
    try {
      const result = await postContact(contact);
      successCount++;
      results.push({ ok: true, contact: `${contact.first_name} ${contact.last_name}`, company_id: contact.company_id, id: result.id });
      console.log(`  OK: [company ${contact.company_id}] ${contact.first_name} ${contact.last_name} - ${contact.title}`);
    } catch (err) {
      errorCount++;
      results.push({ ok: false, contact: `${contact.first_name} ${contact.last_name}`, error: err.message });
      console.error(`  ERROR: [company ${contact.company_id}] ${contact.first_name} ${contact.last_name}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${successCount} inserted, ${errorCount} errors`);
  return results;
}

insertAll().catch(console.error);
