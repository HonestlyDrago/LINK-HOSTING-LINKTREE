const { Pool } = require('pg');
if (process.env.NODE_ENV !== 'production') { try { require('dotenv').config(); } catch(e) {} }

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'admin' : null);

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
}

const DEFAULT_SETTINGS = { enabled: false, mode: 'image_and_text', title: 'Submit Your Proof', placeholder: 'e.g. Task name or activity' };

async function ensureTables(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS proofs (
    id SERIAL PRIMARY KEY,
    task_name VARCHAR(255) NOT NULL,
    description TEXT,
    image_data TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`);
  await client.query(`CREATE TABLE IF NOT EXISTS page_content (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`);
}

async function getSettings(client) {
  const r = await client.query("SELECT value FROM page_content WHERE key='proof_settings';");
  return r.rows.length ? { ...DEFAULT_SETTINGS, ...JSON.parse(r.rows[0].value) } : DEFAULT_SETTINGS;
}

function isAuth(req) {
  if (!ADMIN_PASSWORD) return false;
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') && h.split(' ')[1] === ADMIN_PASSWORD;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!pool) return res.status(503).json({ error: 'Database not configured' });

  let client;
  try {
    client = await pool.connect();
    await ensureTables(client);

    // GET — return settings + proofs (admin sees all, public sees settings only)
    if (req.method === 'GET') {
      const settings = await getSettings(client);
      // Only return proof list to admin
      if (isAuth(req)) {
        const r = await client.query('SELECT id,task_name,description,image_data,submitted_at FROM proofs ORDER BY submitted_at DESC LIMIT 200;');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ settings, proofs: r.rows });
      }
      // Public only gets settings (to know if form should show)
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ settings });
    }

    // POST — either save settings (admin) or submit a proof (public)
    if (req.method === 'POST') {
      const body = req.body || {};

      // Admin: save settings
      if (body.type === 'settings') {
        if (!isAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
        const s = { enabled: !!body.enabled, mode: body.mode === 'text_only' ? 'text_only' : 'image_and_text', title: (body.title||'Submit Your Proof').trim().slice(0,100), placeholder: (body.placeholder||'').trim().slice(0,200) };
        await client.query(
          `INSERT INTO page_content (key,value,updated_at) VALUES ('proof_settings',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();`,
          [JSON.stringify(s)]
        );
        return res.status(200).json({ success: true, settings: s });
      }

      // Public: submit proof
      const settings = await getSettings(client);
      if (!settings.enabled) return res.status(403).json({ error: 'Proof submissions are disabled.' });

      const { task_name, description, image_data } = body;
      if (!task_name) return res.status(400).json({ error: 'task_name is required.' });
      if (settings.mode === 'image_and_text' && !image_data) return res.status(400).json({ error: 'An image is required for this proof.' });
      if (image_data && image_data.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max ~3MB). Compress it first.' });

      const r = await client.query(
        'INSERT INTO proofs (task_name,description,image_data) VALUES ($1,$2,$3) RETURNING id,task_name,description,submitted_at;',
        [task_name.trim().slice(0,255), (description||'').trim().slice(0,500), image_data||null]
      );
      return res.status(201).json({ success: true, proof: r.rows[0] });
    }

    // DELETE — admin only
    if (req.method === 'DELETE') {
      if (!isAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { id } = req.query || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      await client.query('DELETE FROM proofs WHERE id=$1;', [parseInt(id)]);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};
