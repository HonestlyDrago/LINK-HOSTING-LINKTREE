# 🚀 Ultra-Fast Dynamic URL Redirector & Linktree Portal on Vercel

A premium, serverless dynamic URL redirector and **Linktree-style landing page** with a password-protected **Admin Link Manager Dashboard**.

Designed with **glassmorphism** aesthetics and built as a Node.js Vercel project, this tool acts as a highly resilient link bridge for micro-job platforms, social channels, and affiliate hubs.

---

## ⚡ Core Features

* **Instant Link Redirection:** Share direct links like `yourdomain.com/tg` and users are instantly redirected (302 Found) to the target URL with sub-10ms latency.
* **Premium Linktree Panel:** If users visit the root domain `yourdomain.com/`, they are greeted by a beautiful dark glassmorphic landing page displaying all active links, social follow rows, platform-specific SVG icons, and loading skeletons.
* **Secure Admin Control Panel:** Manage links at `yourdomain.com/admin`. Fully equipped to list, create, inline edit, delete, and copy redirect links in one click. Protected by token authentication.
* **Automatic DB Setup:** Initialize your database table and indexes directly from your browser in 1-click via the Admin panel. No database console DDL typing required!
* **Global Edge Caching:** Combines Vercel serverless power with Edge CDN headers (`s-maxage=60`, `stale-while-revalidate=30`). Serves thousands of users concurrently with zero database load.
* **Resilient Fail-Safe Mode:** If the database goes offline or is misconfigured, the app seamlessly falls back to environment-defined redirect keys (e.g. `REDIRECT_URL_MYSLUG`) to keep link bridges running.

---

## 📁 Workspace Layout
```
.
├── api/
│   ├── redirect.js      # Core Redirector: serves Linktree or does 302 redirects
│   ├── links.js         # RESTful CRUD API (GET, POST, DELETE with Auth)
│   └── setup.js         # Database Table Auto-Initializer script
├── public/
│   ├── index.html       # Linktree dynamic landing page
│   ├── admin.html       # Interactive Link Manager console
│   └── styles.css       # Unified design tokens and glassmorphism styling
├── vercel.json          # Multi-route Rewrites routing map
└── package.json         # Project metadata and dependencies
```

---

## 💾 Database Table DDL Schema

If initializing manually, run the following SQL command in your PostgreSQL cluster (e.g. **Neon**, **Supabase**, or standard PostgreSQL):

```sql
CREATE TABLE redirects (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(255) UNIQUE NOT NULL,
    destination_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optimize search lookups to sub-millisecond execution times
CREATE INDEX idx_redirects_slug ON redirects(slug);
```

> [!TIP]
> **No SQL Shell handy?** Don't worry! Once deployed, visit the `/admin` portal, log in, and click the **"Quick Initialize DB Table"** button to let Vercel handle table creation automatically!

---

## ⚙️ Project Environment Variables

Add these environment keys to your local `.env` file or in the **Vercel Settings > Environment Variables** tab:

| Variable Name | Required | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` (or `POSTGRES_URL`) | Optional | `""` | PostgreSQL connection string. (Optional: local fallback mode is active if missing). |
| `ADMIN_PASSWORD` | Yes (Prod) | `"admin"` (in Dev) | Secret token/password used to login to `/admin` and write links. |
| `REDIRECT_ROOT_DIRECT` | Optional | `"false"` | **Toggle:** Set to `true` to make the root route (`/`) instantly redirect instead of loading the Linktree landing page. |
| `DEFAULT_REDIRECT_URL` | Yes | `https://google.com` | Safe fallback URL if a slug is missing or DB query fails. |
| `REDIRECT_URL_[SLUG]` | Optional | `""` | Specific fallback URL for a given slug (e.g., `REDIRECT_URL_JOB1` fallback for `/job1`). |

---

## 🛠️ Local Development & Quickstart

### 1. Installation
Ensure Vercel CLI is installed, clone this directory, and set up your node modules:
```bash
npm install -g vercel
npm install
```

### 2. Configure Environment
Create a `.env` file in the root workspace folder:
```env
ADMIN_PASSWORD=my_secret_token
DEFAULT_REDIRECT_URL=https://google.com
REDIRECT_ROOT_DIRECT=false
# Option: Add a PostgreSQL link to test SQL persistence locally
# DATABASE_URL=postgresql://user:pass@localhost:5432/db
```

### 3. Launch Development Server
```bash
npm start
```
Open `http://localhost:3000` to preview.

* **Browse Landing Page:** `http://localhost:3000/`
* **Browse Manager Dashboard:** `http://localhost:3000/admin` (Enter your configured password to access!)
* **Test Direct Redirect Slug:** `http://localhost:3000/my-custom-slug` (Redirects to fallback or DB destination URL).

---

## 🚀 Deploying to Vercel

### Deploy via CLI
Execute:
```bash
vercel --prod
```

### Continuous Git Deployments
1. Push this workspace to your private GitHub/GitLab account.
2. Link the repository to your Vercel Account.
3. Configure your Environment Variables in the project settings.
4. Deploy! Future commits will trigger automatic incremental updates.
