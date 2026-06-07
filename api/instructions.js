const { Pool } = require('pg');
if (process.env.NODE_ENV !== 'production') { try { require('dotenv').config(); } catch(e) {} }

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'admin' : null);

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
}

async function ensureTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS page_content (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
}

function isAuth(req) {
  if (!ADMIN_PASSWORD) return false;
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') && h.split(' ')[1] === ADMIN_PASSWORD;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!pool) return res.status(503).json({ error: 'Database not configured' });

  let client;
  try {
    client = await pool.connect();
    await ensureTable(client);

    if (req.method === 'GET') {
      const r = await client.query("SELECT value FROM page_content WHERE key='instruction_blocks';");
      const blocks = r.rows.length ? JSON.parse(r.rows[0].value) : [];
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ blocks });
    }

    if (req.method === 'POST') {
      if (!isAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
      const { blocks } = req.body || {};
      if (!Array.isArray(blocks)) return res.status(400).json({ error: 'blocks must be array' });
      await client.query(
        `INSERT INTO page_content (key,value,updated_at) VALUES ('instruction_blocks',$1,NOW())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();`,
        [JSON.stringify(blocks)]
      );
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};
