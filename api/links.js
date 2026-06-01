const { Pool } = require('pg');

// Setup development environment
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (e) {}
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'admin' : null);

// DB Connection Pool
let pool = null;
if (DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000,
      ssl: { rejectUnauthorized: false }
    });
  } catch (err) {
    console.error('API Links - Pool Init Failed:', err);
  }
}

/**
 * Authentication Helper
 */
function isAuthorized(req) {
  // If no password is set on the server, block all writes in production
  if (!ADMIN_PASSWORD) {
    console.warn('ADMIN_PASSWORD is not configured on the server. Write requests blocked.');
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.split(' ')[1];
  return token === ADMIN_PASSWORD;
}

/**
 * CRUD Links Endpoint
 */
module.exports = async (req, res) => {
  // CORS Headers for easy local dev querying
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ==========================================
  // GET: Retrieve all links (Landing Page / Admin)
  // ==========================================
  if (req.method === 'GET') {
    let links = [];

    // 1. Gather any Environment Variable links
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('REDIRECT_URL_')) {
        const slug = key.replace('REDIRECT_URL_', '').toLowerCase();
        links.push({
          slug: slug,
          destination_url: process.env[key],
          is_env: true,
          created_at: new Date().toISOString()
        });
      }
    }

    // 2. Fetch DB links if connected
    if (pool) {
      let client;
      try {
        client = await pool.connect();
        const result = await client.query('SELECT slug, destination_url, description, is_footer, created_at FROM redirects ORDER BY slug ASC;');
        
        // Merge DB results (DB takes precedence if same slug exists)
        const dbSlugs = new Set();
        const dbLinks = result.rows.map(row => {
          dbSlugs.add(row.slug);
          return {
            slug: row.slug,
            destination_url: row.destination_url,
            description: row.description,
            is_footer: row.is_footer || false,
            is_env: false,
            created_at: row.created_at
          };
        });

        // Combine: filter out env variables overridden by DB
        links = [
          ...dbLinks,
          ...links.filter(l => !dbSlugs.has(l.slug))
        ];
      } catch (err) {
        console.error('API Links GET - Database Query Failed:', err.message);
        // Serve whatever environment variables we have as graceful fallback
      } finally {
        if (client) client.release();
      }
    }

    // Return the response with cache disabled for the admin/retrieval view to show fresh data
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ links, db_active: !!pool });
  }

  // ==========================================
  // POST: Create or Update a link (Requires Auth)
  // ==========================================
  if (req.method === 'POST') {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
    }

    const { slug, destination_url, description, is_footer } = req.body || {};
    if (!slug || !destination_url) {
      return res.status(400).json({ error: 'Bad Request: "slug" and "destination_url" are required fields.' });
    }

    const cleanSlug = slug.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    const cleanUrl = destination_url.trim();
    const cleanDesc = description ? description.trim() : null;
    const cleanIsFooter = !!is_footer;

    if (!cleanSlug || cleanSlug === 'admin' || cleanSlug === 'api') {
      return res.status(400).json({ error: 'Bad Request: Reserved or invalid slug.' });
    }

    try {
      new URL(cleanUrl);
    } catch (_) {
      return res.status(400).json({ error: 'Bad Request: "destination_url" must be a valid absolute HTTP/HTTPS URL.' });
    }

    if (!pool) {
      return res.status(503).json({ error: 'Service Unavailable: Database connection is not configured. Direct edits disabled.' });
    }

    let client;
    try {
      client = await pool.connect();

      // If this link is set as a footer shortcut, we should reset is_footer = false for any other links 
      // of the SAME platform class (tg, wa, yt) to ensure only ONE default/pinned link is rendered in the footer!
      if (cleanIsFooter) {
        const destLower = cleanUrl.toLowerCase();
        let platformMatch = null;
        if (cleanSlug === 'telegram' || cleanSlug === 'tg' || destLower.includes('t.me/')) platformMatch = 'telegram';
        if (cleanSlug === 'whatsapp' || cleanSlug === 'wa' || destLower.includes('wa.me/')) platformMatch = 'whatsapp';
        if (cleanSlug === 'youtube' || cleanSlug === 'yt' || destLower.includes('youtube.com/') || destLower.includes('youtu.be/')) platformMatch = 'youtube';

        if (platformMatch) {
          // Identify files matching this platform and turn off their is_footer pin
          const selectQuery = 'SELECT id, slug, destination_url FROM redirects;';
          const currentLinks = await client.query(selectQuery);
          const idsToReset = [];
          for (const row of currentLinks.rows) {
            const rDest = row.destination_url.toLowerCase();
            const rSlug = row.slug.toLowerCase();
            let isSamePlatform = false;
            if (platformMatch === 'telegram' && (rSlug === 'telegram' || rSlug === 'tg' || rDest.includes('t.me/'))) isSamePlatform = true;
            if (platformMatch === 'whatsapp' && (rSlug === 'whatsapp' || rSlug === 'wa' || rDest.includes('wa.me/'))) isSamePlatform = true;
            if (platformMatch === 'youtube' && (rSlug === 'youtube' || rSlug === 'yt' || rDest.includes('youtube.com/') || rDest.includes('youtu.be/'))) isSamePlatform = true;

            if (isSamePlatform && row.slug !== cleanSlug) {
              idsToReset.push(row.id);
            }
          }

          if (idsToReset.length > 0) {
            await client.query('UPDATE redirects SET is_footer = FALSE WHERE id = ANY($1);', [idsToReset]);
          }
        }
      }

      const queryText = `
        INSERT INTO redirects (slug, destination_url, description, is_footer, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (slug)
        DO UPDATE SET destination_url = EXCLUDED.destination_url, description = EXCLUDED.description, is_footer = EXCLUDED.is_footer, updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `;
      const result = await client.query(queryText, [cleanSlug, cleanUrl, cleanDesc, cleanIsFooter]);
      return res.status(200).json({ success: true, link: result.rows[0] });
    } catch (err) {
      console.error('API Links POST - Database Insertion Failed:', err);
      return res.status(500).json({ error: 'Internal Server Error: Failed to save to database.' });
    } finally {
      if (client) client.release();
    }
  }

  // ==========================================
  // DELETE: Delete a link (Requires Auth)
  // ==========================================
  if (req.method === 'DELETE') {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
    }

    const { slug } = req.query || {};
    if (!slug) {
      return res.status(400).json({ error: 'Bad Request: "slug" is required to delete.' });
    }

    const cleanSlug = slug.trim().toLowerCase();

    if (!pool) {
      return res.status(503).json({ error: 'Service Unavailable: Database connection is not configured. Direct deletions disabled.' });
    }

    let client;
    try {
      client = await pool.connect();
      const result = await client.query('DELETE FROM redirects WHERE slug = $1 RETURNING *;', [cleanSlug]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: `Not Found: No link found with slug "${cleanSlug}"` });
      }

      return res.status(200).json({ success: true, deleted: result.rows[0] });
    } catch (err) {
      console.error('API Links DELETE - Database Deletion Failed:', err);
      return res.status(500).json({ error: 'Internal Server Error: Failed to delete from database.' });
    } finally {
      if (client) client.release();
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method Not Allowed' });
};
