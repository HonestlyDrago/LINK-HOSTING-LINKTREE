const { Pool } = require('pg');

// Setup development environment
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (e) {}
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'admin' : null);

module.exports = async (req, res) => {
  const { password } = req.query || {};

  // Simple quick check: requires password param in URL, e.g. /api/setup?password=xxx
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing "password" query parameter.' });
  }

  if (!DATABASE_URL) {
    return res.status(503).json({ error: 'Service Unavailable: DATABASE_URL is not configured in Vercel settings.' });
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  let client;
  try {
    client = await pool.connect();

    // 1. Create table DDL (with description and is_footer column support)
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS redirects (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(255) UNIQUE NOT NULL,
        destination_url TEXT NOT NULL,
        description TEXT,
        is_footer BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.query(createTableQuery);

    // 1b. Schema Migration: Ensure description and is_footer columns exist in active databases
    await client.query('ALTER TABLE redirects ADD COLUMN IF NOT EXISTS description TEXT;');
    await client.query('ALTER TABLE redirects ADD COLUMN IF NOT EXISTS is_footer BOOLEAN DEFAULT FALSE;');

    // 2. Create index DDL
    const createIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_redirects_slug ON redirects(slug);
    `;
    await client.query(createIndexQuery);

    // 3. Seed default active_link row DDL
    const seedQuery = `
      INSERT INTO redirects (slug, destination_url)
      VALUES ('active_link', 'https://google.com')
      ON CONFLICT (slug) DO NOTHING;
    `;
    await client.query(seedQuery);

    return res.status(200).json({
      success: true,
      message: 'Database setup completed successfully! The "redirects" table, slug index, and root active_link seed are ready.'
    });
  } catch (error) {
    console.error('Database setup failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Database setup failed',
      details: error.message
    });
  } finally {
    if (client) client.release();
    await pool.end();
  }
};
