// Livre d'or — l'app du defi final, sprint DevOps MeggieOnTheStack, Promo 001
// Deux modes, selon l'environnement. C'est comme ca qu'une vraie app se configure.
//   - Sans DATABASE_URL : les messages vont dans un fichier (DATA_DIR, par defaut /data)
//   - Avec DATABASE_URL : les messages vont dans un vrai Postgres
// A TOI d'ecrire le Dockerfile et le compose.yml. C'est tout l'interet.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATABASE_URL = process.env.DATABASE_URL || '';
const FICHIER = path.join(DATA_DIR, 'messages.json');

let pool = null;
let modePret = false;

// ---------- Mode fichier ----------

function lireFichier() {
  try {
    return JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
  } catch {
    return [];
  }
}

function ecrireFichier(pseudo, texte) {
  const messages = lireFichier();
  messages.push({ pseudo, texte, date: new Date().toISOString() });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FICHIER, JSON.stringify(messages, null, 2));
}

// ---------- Mode base de donnees ----------

async function initBase() {
  let Pool;
  try {
    Pool = require('pg').Pool;
  } catch {
    console.error('DATABASE_URL est definie mais le module pg est absent. Lance npm install.');
    process.exit(1);
  }
  pool = new Pool({ connectionString: DATABASE_URL });
  // La base peut demarrer APRES l'app. depends_on ne garantit pas qu'elle est prete.
  // Alors on insiste poliment, toutes les 2 secondes, au lieu de mourir.
  for (let essai = 1; essai <= 30; essai++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        pseudo TEXT NOT NULL,
        texte TEXT NOT NULL,
        date TIMESTAMPTZ DEFAULT now()
      )`);
      modePret = true;
      console.log('Base de donnees prete.');
      return;
    } catch (e) {
      console.log(`Base pas encore prete (essai ${essai}/30), nouvelle tentative dans 2 s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('Impossible de joindre la base apres 30 essais. Verifie DATABASE_URL et ton reseau.');
  process.exit(1);
}

async function lireBase() {
  const r = await pool.query('SELECT pseudo, texte FROM messages ORDER BY id');
  return r.rows;
}

async function ecrireBase(pseudo, texte) {
  await pool.query('INSERT INTO messages (pseudo, texte) VALUES ($1, $2)', [pseudo, texte]);
}

// ---------- Le serveur ----------

function page(messages, mode) {
  const liste = messages
    .map(m => `<li><strong>${m.pseudo}</strong> : ${m.texte}</li>`)
    .join('\n');
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Livre d'or — Promo 001</title></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 40px auto;">
  <h1>Livre d'or de la promo 001</h1>
  <p>Stockage actuel. <strong>${mode}</strong></p>
  <p>${messages.length} message(s). Si tu lis ceci depuis un conteneur, la boite tourne.</p>
  <form method="POST" action="/message">
    <input name="pseudo" placeholder="Ton pseudo" required>
    <input name="texte" placeholder="Ton message" required>
    <button>Signer</button>
  </form>
  <ul>${liste}</ul>
</body>
</html>`;
}

const serveur = http.createServer((req, res) => {
  const enBase = Boolean(DATABASE_URL);
  const mode = enBase ? 'base de donnees Postgres' : 'fichier local';

  if (enBase && !modePret) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('La base de donnees n\'est pas encore prete, reessaie dans quelques secondes.');
    return;
  }

  if (req.method === 'POST' && req.url === '/message') {
    let corps = '';
    req.on('data', morceau => { corps += morceau; });
    req.on('end', async () => {
      const params = new URLSearchParams(corps);
      const pseudo = (params.get('pseudo') || 'anonyme').slice(0, 40);
      const texte = (params.get('texte') || '').slice(0, 200);
      try {
        if (texte) {
          if (enBase) await ecrireBase(pseudo, texte);
          else ecrireFichier(pseudo, texte);
        }
        res.writeHead(303, { Location: '/' });
        res.end();
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Erreur en ecrivant le message : ' + e.message);
      }
    });
    return;
  }

  (async () => {
    try {
      const messages = enBase ? await lireBase() : lireFichier();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(messages, mode));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erreur en lisant les messages : ' + e.message);
    }
  })();
});

async function demarrer() {
  if (DATABASE_URL) await initBase();
  serveur.listen(PORT, () => {
    console.log(`Livre d'or demarre sur le port ${PORT}.`);
    console.log(DATABASE_URL
      ? 'Mode base de donnees Postgres.'
      : `Mode fichier, donnees dans ${DATA_DIR}.`);
  });
}

demarrer();