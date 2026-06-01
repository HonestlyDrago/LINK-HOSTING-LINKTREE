const { Pool } = require('pg');

// Load local environment variables if running in dev environment
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (e) {
    // dotenv is optional in production
  }
}

// Configurable constants
const DEFAULT_REDIRECT_URL = process.env.DEFAULT_REDIRECT_URL || 'https://google.com';
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

// Initialize PostgreSQL pool outside the handler for warm-start reuse
let pool = null;
if (DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 10,                         // Keep pool size small for Serverless context
      idleTimeoutMillis: 15000,        // Close idle clients relatively fast
      connectionTimeoutMillis: 15000,   // Fail fast if database is unreachable
      ssl: {
        rejectUnauthorized: false      // Required for modern cloud databases like Supabase/Neon
      }
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle database client:', err);
    });
  } catch (error) {
    console.error('Failed to initialize PostgreSQL connection pool:', error);
  }
} else {
  console.warn('DATABASE_URL is not set. Running in Environment Variable fallback-only mode.');
}

/**
 * Serverless redirect handler
 */
module.exports = async (req, res) => {
  // Only accept GET/HEAD requests to prevent side effects
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Parse path to extract the slug
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  
  // Clean up the slug (e.g. remove leading/trailing slashes)
  let slug = pathname.replace(/^\/+|\/+$/g, '');
  
  // If route is root "/", handle Linktree landing page or instant redirect
  if (!slug) {
    if (process.env.REDIRECT_ROOT_DIRECT !== 'true') {
      try {
        const fs = require('fs');
        const path = require('path');
        const indexPath = path.join(process.cwd(), 'public/index.html');
        const htmlContent = fs.readFileSync(indexPath, 'utf8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=600');
        return res.status(200).send(htmlContent);
      } catch (err) {
        console.error('Error serving index.html dynamically:', err);
        // Fallback to redirection if reading file fails
      }
    }
    slug = 'active_link';
  }

  let targetUrl = null;

  // Try fetching from the database if pool is configured
  if (pool) {
    let client;
    try {
      // Get connection client from the pool
      client = await pool.connect();
      
      // Query the database for the active slug
      const queryText = 'SELECT destination_url FROM redirects WHERE slug = $1 LIMIT 1;';
      const result = await client.query(queryText, [slug]);

      if (result.rows && result.rows.length > 0) {
        targetUrl = result.rows[0].destination_url;
      } else {
        console.warn(`No redirect entry found in database for slug: "${slug}"`);
      }
    } catch (dbError) {
      // Soft fail: log the error but do not crash. Gracefully fallback to Env variable.
      console.error(`Database error during redirect lookup for "${slug}":`, dbError.message);
    } finally {
      // Release client back to the pool
      if (client) {
        client.release();
      }
    }
  }

  // Fallback: If DB query returned nothing, was missing, or failed, use Environment Variables
  if (!targetUrl) {
    // We check if a specific environment variable is set for this slug, e.g. REDIRECT_SLUG_ACTIVE_LINK
    const envSlugKey = `REDIRECT_URL_${slug.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
    targetUrl = process.env[envSlugKey] || DEFAULT_REDIRECT_URL;
    
    console.log(`Using fallback redirect for "${slug}" -> "${targetUrl}"`);
  }

  // Validate the final redirect URL to prevent header injection or malformed URI errors
  try {
    new URL(targetUrl);
  } catch (e) {
    console.error(`Invalid fallback redirect URL configuration: "${targetUrl}". Falling back to safe default.`);
    targetUrl = DEFAULT_REDIRECT_URL;
  }

  // Set response headers for high performance Edge Caching
  // - public: Response can be cached by browser and CDN
  // - max-age=0: Browser must check with Vercel CDN each time
  // - s-maxage=60: Vercel Edge CDN caches the redirect for 60 seconds
  // - stale-while-revalidate=30: Serves stale redirect instantly while updating cache in background
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');

  // HTTP 302 Found (Temporary Redirect) redirecting to the target dynamic URL
  res.setHeader('Location', targetUrl);
  return res.status(302).end();
};
