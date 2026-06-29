const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'admin' : null);

let pool = null;
if (DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      ssl: { rejectUnauthorized: false }
    });
  } catch (err) {
    console.error('API Licenses - Pool Init Failed:', err);
  }
}

function isAuthorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  return token === ADMIN_PASSWORD;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
  }

  if (!pool) {
    return res.status(503).json({ error: 'Service Unavailable: Database connection not configured.' });
  }

  let client;
  try {
    client = await pool.connect();
    // Ensure table exists just in case
    await client.query(`
      CREATE TABLE IF NOT EXISTS generated_licenses (
        id SERIAL PRIMARY KEY,
        pump_name VARCHAR(255) NOT NULL,
        hardware_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const result = await client.query('SELECT * FROM generated_licenses ORDER BY created_at DESC');
    return res.status(200).json({ success: true, licenses: result.rows });
  } catch (error) {
    console.error('API Licenses GET error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    if (client) client.release();
  }
};
