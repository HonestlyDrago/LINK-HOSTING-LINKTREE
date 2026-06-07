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

  // ─────────────────────────────────────────────────────────────────────────
  // Telegram Deep Link Bridge
  // t.me Mini App links opened in a browser do NOT trigger the startapp
  // referral — only the native Telegram app processes it correctly.
  // Solution: serve an HTML bridge page that attempts the tg:// protocol
  // (opens Telegram app directly) and falls back to https://t.me/ after 1.5s.
  // ─────────────────────────────────────────────────────────────────────────
  const tMePattern = /^https?:\/\/t\.me\//i;

  if (tMePattern.test(targetUrl)) {
    // Convert https://t.me/Bot/app?startapp=X  →  tg://resolve?domain=Bot&appname=app&startapp=X
    let tgDeepLink = targetUrl;
    try {
      const tUrl = new URL(targetUrl);
      // Path looks like /BotName  or  /BotName/appname
      const parts = tUrl.pathname.replace(/^\/+/, '').split('/');
      const domain = parts[0] || '';
      const appname = parts[1] || '';

      const tgUrl = new URL('tg://resolve');
      tgUrl.searchParams.set('domain', domain);
      if (appname) tgUrl.searchParams.set('appname', appname);

      // Forward all original query params (e.g. startapp)
      for (const [key, val] of tUrl.searchParams.entries()) {
        tgUrl.searchParams.set(key, val);
      }

      tgDeepLink = tgUrl.toString();
    } catch (convErr) {
      console.warn('Telegram URL conversion failed, using raw t.me link:', convErr.message);
    }

    const safeTarget   = targetUrl.replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const safeDeepLink = tgDeepLink.replace(/"/g, '&quot;').replace(/</g, '&lt;');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Opening Telegram…</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #0f1117;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e0e6f0;
      padding: 1.5rem;
      text-align: center;
    }
    .card {
      background: #1a1f2e;
      border: 1px solid #2a3050;
      border-radius: 20px;
      padding: 2.5rem 2rem;
      max-width: 360px;
      width: 100%;
      box-shadow: 0 8px 40px rgba(0,0,0,0.4);
    }
    .tg-icon {
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, #2AABEE, #229ED9);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.25rem;
      font-size: 2rem;
    }
    h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; }
    p  { font-size: 0.9rem; color: #8896b3; line-height: 1.5; margin-bottom: 1.75rem; }
    .btn {
      display: block;
      width: 100%;
      padding: 0.85rem 1rem;
      border-radius: 12px;
      font-size: 0.95rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: opacity 0.2s;
      margin-bottom: 0.75rem;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary {
      background: linear-gradient(135deg, #2AABEE, #229ED9);
      color: #fff;
      border: none;
    }
    .btn-secondary {
      background: transparent;
      color: #8896b3;
      border: 1px solid #2a3050;
      font-size: 0.8rem;
    }
    .progress {
      height: 3px;
      background: #2a3050;
      border-radius: 99px;
      overflow: hidden;
      margin-top: 1.5rem;
    }
    .progress-bar {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #2AABEE, #229ED9);
      border-radius: 99px;
      transform-origin: left;
      animation: shrink 1.5s linear forwards;
    }
    @keyframes shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="tg-icon">✈️</div>
    <h1>Opening in Telegram</h1>
    <p>You'll be redirected to the Telegram app automatically. If nothing happens, tap the button below.</p>
    <a id="openBtn" href="${safeDeepLink}" class="btn btn-primary">Open in Telegram App</a>
    <a href="${safeTarget}" class="btn btn-secondary">Open in browser instead</a>
    <div class="progress"><div class="progress-bar"></div></div>
  </div>
  <script>
    // Attempt deep link immediately
    window.location.href = "${safeDeepLink}";

    // After 1.5s (matching CSS animation) fall back to https://t.me/
    setTimeout(function() {
      window.location.href = "${safeTarget}";
    }, 1500);
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).send(html);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Standard redirect for all non-Telegram links
  // ─────────────────────────────────────────────────────────────────────────
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');
  res.setHeader('Location', targetUrl);
  return res.status(302).end();
};
