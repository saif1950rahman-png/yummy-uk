# Yummy UK – Restaurant Website

Modern British restaurant website with full admin panel, menu management, and reservation system.

## Tech Stack
- **Backend**: Node.js + Express
- **Database**: SQLite (via better-sqlite3) — zero config, file-based
- **Frontend**: Vanilla HTML, CSS, JS — no frameworks
- **Auth**: bcryptjs + express-session

---

## Folder Structure

```
yummy-uk/
├── server.js          # All routes, DB, admin logic
├── package.json
├── render.yaml        # Render.com deploy config
├── .gitignore
├── yummy.db           # Auto-created on first run
└── public/
    ├── css/
    │   ├── style.css  # Public site styles
    │   └── admin.css  # Admin panel styles
    ├── js/
    │   └── main.js    # Navbar, parallax, animations
    └── images/
        └── default-food.jpg
```

---

## Run Locally

### 1. Install Node.js
Download from https://nodejs.org (v18+ recommended)

### 2. Install dependencies
```bash
cd yummy-uk
npm install
```

### 3. Start the server
```bash
npm start
```

### 4. Open in browser
- **Website**: http://localhost:3000
- **Admin**: http://localhost:3000/admin/login

### Default Admin Credentials
- Username: `admin`
- Password: `admin123`

> ⚠️ Change these after first login by editing the DB or adding a change-password route.

---

## Deploy on Render (Free)

### Step 1 – Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/yummy-uk.git
git push -u origin main
```

### Step 2 – Create Render account
Go to https://render.com and sign up (free).

### Step 3 – New Web Service
1. Click **New → Web Service**
2. Connect your GitHub repo
3. Render auto-detects `render.yaml` — confirm settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node

### Step 4 – Add Disk (for SQLite persistence)
1. In your service settings → **Disks**
2. Add disk:
   - Name: `yummy-data`
   - Mount Path: `/opt/render/project/src`
   - Size: 1 GB (free tier)

### Step 5 – Deploy
Click **Deploy**. Your site will be live at `https://yummy-uk.onrender.com` (or similar).

---

## Features

| Feature | Details |
|---|---|
| Home | Parallax hero, story, menu preview, testimonials, gallery |
| Menu | Tabbed by category, live from DB |
| Reservation | Full form with validation, stored in DB |
| Contact | Contact form + map embed |
| Admin Login | bcrypt-secured |
| Menu Management | Add/edit/delete items, image upload |
| Reservations | View all, filter by today/upcoming, delete |
| SEO | Semantic HTML, meta tags, fast loading |
| Mobile | Responsive, parallax disabled on mobile |

---

## Customisation

- **Restaurant name/address**: Search `Yummy UK` and `Kensington` in `server.js`
- **Phone/email**: Search `7946 0123` in `server.js`
- **Hero image**: Change the Unsplash URL in `.hero` CSS class in `style.css`
- **Admin password**: Update the seed in `server.js` (line with `bcrypt.hashSync`)
- **Colors**: Edit CSS variables at top of `style.css`
