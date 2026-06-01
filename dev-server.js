const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load environment variables locally
try {
  require('dotenv').config();
} catch (e) {
  // Optional in standard Node context
}

// Import local Vercel serverless functions
const redirectHandler = require('./api/redirect');
const linksHandler = require('./api/links');
const setupHandler = require('./api/setup');

const PORT = process.env.PORT || 3000;

/**
 * Mock Vercel response helper to provide status(), json(), and send() support
 */
function mockResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (body) => {
    res.end(body);
    return res;
  };
  return res;
}

// Initialize native HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  // Attach query params like Vercel request parser
  req.query = parsedUrl.query;
  
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', () => {
    if (body) {
      try {
        req.body = JSON.parse(body);
      } catch (e) {
        req.body = body;
      }
    }
    
    // Wrap native response with Vercel helpers
    mockResponse(res);
    
    // Enable CORS in local development for ease of query debugging
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Router matching Vercel.json rewrite configurations
    if (pathname === '/api/links') {
      return linksHandler(req, res);
    } else if (pathname === '/api/setup') {
      return setupHandler(req, res);
    } else if (pathname === '/admin') {
      try {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(fs.readFileSync(path.join(__dirname, 'public/admin.html')));
      } catch (err) {
        return res.status(500).json({ error: 'Failed to read public/admin.html' });
      }
    } else if (pathname === '/styles.css') {
      try {
        res.setHeader('Content-Type', 'text/css');
        return res.end(fs.readFileSync(path.join(__dirname, 'public/styles.css')));
      } catch (err) {
        return res.status(500).send('styles.css not found');
      }
    } else if (pathname === '/avatar.png') {
      try {
        res.setHeader('Content-Type', 'image/png');
        return res.end(fs.readFileSync(path.join(__dirname, 'public/avatar.png')));
      } catch (err) {
        return res.status(404).send('avatar.png not found');
      }
    } else if (pathname === '/' || pathname === '/index.html') {
      // Let the main redirect.js serve public/index.html or 302 redirect conditionally
      return redirectHandler(req, res);
    } else if (pathname === '/favicon.ico') {
      return res.status(404).end();
    } else {
      // Any other route path is evaluated as a redirect bridge slug (e.g. /telegram)
      return redirectHandler(req, res);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 LOCAL SIMULATED VERCEL SERVER RUNNING SUCCESSFULLY`);
  console.log(`=============================================================`);
  console.log(`👉 Main Linktree Landing Page : http://localhost:${PORT}/`);
  console.log(`👉 Secure Admin Control Panel : http://localhost:${PORT}/admin`);
  console.log(`\nLocal password token: "admin" (defined inside local environment)`);
  console.log(`=============================================================\n`);
});
