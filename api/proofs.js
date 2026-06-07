const { Pool } = require('pg');
if (process.env.NODE_ENV !== 'production') { try { require('dotenv').config(); } catch(e) {} }

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'admin' : null);

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
}

async function ensureTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS proofs (
    id SERIAL PRIMARY KEY,
    task_name VARCHAR(255) NOT NULL,
    description TEXT,
    image_data TEXT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`);
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
    await ensureTable(client);

    if (req.method === 'GET') {
      const r = await client.query('SELECT id,task_name,description,image_data,submitted_at FROM proofs ORDER BY submitted_at DESC LIMIT 100;');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ proofs: r.rows });
    }

    if (req.method === 'POST') {
      const { task_name, description, image_data } = req.body || {};
      if (!task_name || !image_data) return res.status(400).json({ error: 'task_name and image_data required' });
      if (image_data.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max ~3MB). Compress before uploading.' });
      const r = await client.query(
        'INSERT INTO proofs (task_name,description,image_data) VALUES ($1,$2,$3) RETURNING id,task_name,description,submitted_at;',
        [task_name.trim().slice(0,255), (description||'').trim().slice(0,500), image_data]
      );
      return res.status(201).json({ success: true, proof: r.rows[0] });
    }

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
