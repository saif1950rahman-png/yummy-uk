'use strict';

const express        = require('express');
const session        = require('express-session');
const bcrypt         = require('bcryptjs');
const path           = require('path');
const fs             = require('fs');
const multer         = require('multer');
const initSqlJs      = require('sql.js');

const app     = express();
const PORT    = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'yummy.db');

// ─────────────────────────────────────────────────────────────────────────────
// DB LAYER  (sql.js thin wrapper)
// ─────────────────────────────────────────────────────────────────────────────
let sqlDb;

function saveDb () {
  fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export()));
}

/** Bind ? placeholders with safely-quoted values */
function bind (sql, params = []) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === undefined || v === null) return 'NULL';
    if (typeof v === 'number')         return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

const db = {
  run (sql, params = []) {
    sqlDb.run(bind(sql, params));
    saveDb();
  },
  get (sql, params = []) {
    const res = sqlDb.exec(bind(sql, params));
    if (!res[0]) return undefined;
    return Object.fromEntries(res[0].columns.map((c, i) => [c, res[0].values[0][i]]));
  },
  all (sql, params = []) {
    const res = sqlDb.exec(bind(sql, params));
    if (!res[0]) return [];
    return res[0].values.map(row =>
      Object.fromEntries(res[0].columns.map((c, i) => [c, row[i]])));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
async function boot () {
  const SQL = await initSqlJs();
  sqlDb = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  // Schema
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      price       REAL    NOT NULL,
      category    TEXT    DEFAULT 'mains',
      image       TEXT    DEFAULT '/images/default-food.jpg',
      available   INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      email      TEXT DEFAULT '',
      date       TEXT NOT NULL,
      time       TEXT NOT NULL,
      guests     INTEGER NOT NULL,
      notes      TEXT DEFAULT '',
      status     TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
  `);
  saveDb();

  // Seed admin
  const adminExists = db.get('SELECT id FROM admin_users WHERE username = ?', ['admin']);
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run('INSERT INTO admin_users (username, password) VALUES (?, ?)', ['admin', hash]);
  }

  // Seed menu
  const { c: menuCount } = db.get('SELECT COUNT(*) as c FROM menu_items') || { c: 0 };
  if (menuCount === 0) {
    const items = [
      ['Grilled Sea Bass',      'Pan-seared with lemon butter, capers & fresh dill',          24.50, 'mains',    'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=400&q=75'],
      ['Ribeye Steak 10oz',     'Aged 28 days, served with truffle fries & peppercorn sauce',  38.00, 'mains',    'https://images.unsplash.com/photo-1558030006-450675393462?w=400&q=75'],
      ['Mushroom Risotto',      'Wild mushroom, aged parmesan, white truffle oil',             17.50, 'mains',    'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400&q=75'],
      ['Burrata Salad',         'Fresh burrata, heirloom tomatoes, basil oil & sea salt',      13.00, 'starters', 'https://images.unsplash.com/photo-1592417817098-8fd3d9eb14a5?w=400&q=75'],
      ['Crispy Calamari',       'Lightly dusted, fried golden, served with aioli',             11.50, 'starters', 'https://images.unsplash.com/photo-1599487489994-c0c2deb94148?w=400&q=75'],
      ['French Onion Soup',     'Slow-cooked with gruyere crouton',                            10.00, 'starters', 'https://images.unsplash.com/photo-1547592180-85f173990554?w=400&q=75'],
      ['Sticky Toffee Pudding', 'Warm date sponge, butterscotch sauce, clotted cream',          9.00, 'desserts', 'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=400&q=75'],
      ['Creme Brulee',          'Classic Madagascan vanilla, caramelised sugar',                8.50, 'desserts', 'https://images.unsplash.com/photo-1470124182917-cc6e71b22ecc?w=400&q=75'],
      ['Chocolate Fondant',     'Warm dark chocolate, salted caramel ice cream',                9.50, 'desserts', 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=400&q=75'],
    ];
    for (const [name, desc, price, cat, img] of items) {
      db.run(
        'INSERT INTO menu_items (name, description, price, category, image) VALUES (?, ?, ?, ?, ?)',
        [name, desc, price, cat, img]
      );
    }
  }

  // ── Middleware ────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'yummy-uk-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3_600_000 }
  }));

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(__dirname, 'public/images')),
    filename:    (_req,  file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '-')}`)
  });
  const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

  const requireAuth = (req, res, next) => {
    if (req.session.admin) return next();
    res.redirect('/admin/login');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // HTML HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  const head = (title, desc) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Yummy UK</title>
  <meta name="description" content="${desc}">
  <meta name="theme-color" content="#1a1008">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head><body>`;

  const nav = (active) => `
<nav class="navbar" id="navbar">
  <div class="nav-inner">
    <a href="/" class="logo">Yummy <span>UK</span></a>
    <button class="hamburger" id="hamburger" aria-label="Open menu">
      <span></span><span></span><span></span>
    </button>
    <ul class="nav-links" id="navLinks">
      <li><a href="/"            class="${active==='home'        ?'active':''}">Home</a></li>
      <li><a href="/menu"        class="${active==='menu'        ?'active':''}">Menu</a></li>
      <li><a href="/reservation" class="${active==='reservation' ?'active':''}">Reserve</a></li>
      <li><a href="/contact"     class="${active==='contact'     ?'active':''}">Contact</a></li>
      <li><a href="/reservation" class="btn-book">Book Table</a></li>
    </ul>
  </div>
</nav>`;

  const footer = () => `
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-col">
      <h3>Yummy <span>UK</span></h3>
      <p>A celebration of modern British cuisine with bold, seasonal flavours in the heart of London.</p>
    </div>
    <div class="footer-col">
      <h4>Quick Links</h4>
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/menu">Menu</a></li>
        <li><a href="/reservation">Reservations</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>Hours</h4>
      <p>Mon–Fri: 12pm – 11pm</p>
      <p>Sat–Sun: 11am – 11:30pm</p>
    </div>
    <div class="footer-col">
      <h4>Find Us</h4>
      <p>42 Kensington High St<br>London, W8 4PT</p>
      <p>+44 20 7946 0123</p>
    </div>
  </div>
  <div class="footer-bottom">
    <p>&copy; ${new Date().getFullYear()} Yummy UK. All rights reserved.</p>
  </div>
</footer>`;

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC ROUTES
  // ─────────────────────────────────────────────────────────────────────────

  // HOME
  app.get('/', (_req, res) => {
    const featured = db.all('SELECT * FROM menu_items WHERE available=1 LIMIT 3');
    const testi = [
      { name: 'Sarah T.',  stars: 5, text: "Absolutely breathtaking food. The sea bass was perfection — we'll be back every month." },
      { name: 'James K.',  stars: 5, text: 'Best dining experience in London. Impeccable service, stunning atmosphere.' },
      { name: 'Priya M.',  stars: 5, text: 'The mushroom risotto was divine. Every detail considered. Highly recommend.' },
    ];
    const galleryUrls = [
      'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=500&q=70',
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500&q=70',
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=500&q=70',
      'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=500&q=70',
      'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500&q=70',
    ];

    res.send(`${head('Home', 'Yummy UK – Award-winning modern British restaurant in London. Book your table today.')}
${nav('home')}
<main>

  <section class="hero">
    <div class="hero-overlay"></div>
    <div class="hero-content">
      <p class="hero-tagline">Modern British Cuisine</p>
      <h1>Food That Tells<br><em>A Story</em></h1>
      <p class="hero-sub">Seasonal ingredients. Bold flavours. Unforgettable evenings.</p>
      <div class="hero-cta">
        <a href="/reservation" class="btn-primary">Book a Table</a>
        <a href="/menu"        class="btn-secondary">View Menu</a>
      </div>
    </div>
    <div class="scroll-hint">&#8595;</div>
  </section>

  <section class="about-strip">
    <div class="container">
      <div class="strip-grid">
        <div class="strip-item"><span class="icon">&#9733;</span><h3>Award Winning</h3><p>Michelin recommended since 2021</p></div>
        <div class="strip-item"><span class="icon">&#9832;</span><h3>Seasonal Menu</h3><p>Changed monthly with finest produce</p></div>
        <div class="strip-item"><span class="icon">&#9672;</span><h3>Private Dining</h3><p>Exclusive events up to 40 guests</p></div>
      </div>
    </div>
  </section>

  <section class="story">
    <div class="container story-grid">
      <div class="story-img">
        <div class="img-frame">
          <img src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=700&q=80" alt="Yummy UK kitchen" loading="lazy">
          <div class="img-badge">Est. 2018</div>
        </div>
      </div>
      <div class="story-text">
        <span class="section-label">Our Story</span>
        <h2>Crafted with Passion,<br>Served with Pride</h2>
        <p>Founded by Chef Marcus Webb, Yummy UK was born from a belief that great British food deserves a seat at the world's finest tables. We source every ingredient within 100 miles of London, working directly with farms, fishmongers, and artisan producers.</p>
        <p>Our kitchen team changes the menu monthly so every visit feels like a new discovery.</p>
        <a href="/menu" class="btn-primary">Explore the Menu</a>
      </div>
    </div>
  </section>

  <section class="menu-preview">
    <div class="container">
      <div class="section-header">
        <span class="section-label">From Our Kitchen</span>
        <h2>Signature Dishes</h2>
      </div>
      <div class="preview-grid">
        ${featured.map(item => `
        <div class="preview-card">
          <div class="card-img-wrap">
            <img src="${item.image}" alt="${item.name}" loading="lazy" onerror="this.src='/images/default-food.jpg'">
            <span class="card-cat">${item.category}</span>
          </div>
          <div class="card-body">
            <h3>${item.name}</h3>
            <p>${item.description}</p>
            <span class="price">&#163;${Number(item.price).toFixed(2)}</span>
          </div>
        </div>`).join('')}
      </div>
      <div class="center-btn"><a href="/menu" class="btn-outline">Full Menu &rarr;</a></div>
    </div>
  </section>

  <section class="parallax-cta">
    <div class="parallax-cta-overlay"></div>
    <div class="parallax-cta-content">
      <h2>Reserve Your Evening</h2>
      <p>Join us for an unforgettable dining experience in the heart of London</p>
      <a href="/reservation" class="btn-primary">Book a Table</a>
    </div>
  </section>

  <section class="testimonials">
    <div class="container">
      <div class="section-header">
        <span class="section-label">Guest Voices</span>
        <h2>What People Say</h2>
      </div>
      <div class="testi-grid">
        ${testi.map(t => `
        <div class="testi-card">
          <div class="stars">${'&#9733;'.repeat(t.stars)}</div>
          <p>&ldquo;${t.text}&rdquo;</p>
          <strong>${t.name}</strong>
        </div>`).join('')}
      </div>
    </div>
  </section>

  <section class="gallery-strip">
    <div class="gallery-track">
      ${galleryUrls.map(u => `<div class="gallery-item"><img src="${u}" alt="Yummy UK dish" loading="lazy"></div>`).join('')}
    </div>
  </section>

</main>
${footer()}
<script src="/js/main.js"></script>
</body></html>`);
  });

  // MENU PAGE
  app.get('/menu', (_req, res) => {
    const cats  = ['starters', 'mains', 'desserts'];
    const items = db.all('SELECT * FROM menu_items WHERE available=1 ORDER BY category, id');
    const byCat = {};
    cats.forEach(c => { byCat[c] = items.filter(i => i.category === c); });

    res.send(`${head('Menu', 'Explore the Yummy UK seasonal menu – starters, mains and desserts made from the finest local ingredients.')}
${nav('menu')}
<main>
  <section class="page-hero page-hero--menu">
    <div class="page-hero-overlay"></div>
    <div class="page-hero-content">
      <span class="section-label">What We Offer</span>
      <h1>Our Menu</h1>
      <p>Seasonal &middot; Local &middot; Exceptional</p>
    </div>
  </section>

  <section class="menu-section">
    <div class="container">
      <div class="menu-tabs" id="menuTabs">
        ${cats.map((c, i) => `<button class="tab-btn ${i===0?'active':''}" data-cat="${c}">${c.charAt(0).toUpperCase()+c.slice(1)}</button>`).join('')}
      </div>
      ${cats.map((cat, ci) => `
      <div class="menu-cat" id="cat-${cat}" ${ci!==0?'style="display:none"':''}>
        ${(byCat[cat]||[]).length
          ? (byCat[cat]||[]).map(item => `
          <div class="menu-item-card">
            <img src="${item.image}" alt="${item.name}" loading="lazy" onerror="this.src='/images/default-food.jpg'">
            <div class="menu-item-info">
              <div>
                <h3>${item.name}</h3>
                <p>${item.description}</p>
              </div>
              <span class="price">&#163;${Number(item.price).toFixed(2)}</span>
            </div>
          </div>`).join('')
          : '<p style="color:#999;padding:2rem 0">No items in this category yet.</p>'}
      </div>`).join('')}

      <div class="book-cta-bar">
        <p>Ready to taste it in person?</p>
        <a href="/reservation" class="btn-primary">Book a Table</a>
      </div>
    </div>
  </section>
</main>
${footer()}
<script src="/js/main.js"></script>
<script>
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.menu-cat').forEach(c => c.style.display = 'none');
      document.getElementById('cat-' + btn.dataset.cat).style.display = 'grid';
    });
  });
</script>
</body></html>`);
  });

  // RESERVATION PAGE
  app.get('/reservation', (_req, res) => {
    const times = ['12:00','12:30','13:00','13:30','14:00','18:00','18:30',
                   '19:00','19:30','20:00','20:30','21:00','21:30'];
    res.send(`${head('Book a Table', 'Reserve your table at Yummy UK. Fine dining in London. Book online in seconds.')}
${nav('reservation')}
<main>
  <section class="page-hero page-hero--reservation">
    <div class="page-hero-overlay"></div>
    <div class="page-hero-content">
      <span class="section-label">Reserve Your Table</span>
      <h1>Book a Table</h1>
      <p>We look forward to welcoming you</p>
    </div>
  </section>

  <section class="reservation-section">
    <div class="container">
      <div class="res-grid">
        <div class="res-info">
          <h2>Dining Hours</h2>
          <div class="hours-list">
            <div class="hours-item"><span>Monday &ndash; Friday</span><span>12pm &ndash; 11pm</span></div>
            <div class="hours-item"><span>Saturday</span><span>11am &ndash; 11:30pm</span></div>
            <div class="hours-item"><span>Sunday</span><span>11am &ndash; 10pm</span></div>
          </div>
          <div class="info-note">
            <p>For same-day bookings or parties of 8+, please call us directly.</p>
            <p><strong>+44 20 7946 0123</strong></p>
          </div>
          <div class="res-img-wrap">
            <img src="https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600&q=80" alt="Restaurant interior" loading="lazy">
          </div>
        </div>

        <div class="res-form-wrap">
          <form id="resForm" class="res-form" novalidate>
            <h2>Your Details</h2>
            <div class="form-group">
              <label for="name">Full Name *</label>
              <input type="text" id="name" name="name" placeholder="Jane Smith" required>
              <span class="err" id="nameErr"></span>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="phone">Phone *</label>
                <input type="tel" id="phone" name="phone" placeholder="+44 7700 900000" required>
                <span class="err" id="phoneErr"></span>
              </div>
              <div class="form-group">
                <label for="email">Email</label>
                <input type="email" id="email" name="email" placeholder="you@example.com">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="date">Date *</label>
                <input type="date" id="date" name="date" required>
                <span class="err" id="dateErr"></span>
              </div>
              <div class="form-group">
                <label for="time">Time *</label>
                <select id="time" name="time" required>
                  <option value="">Select time</option>
                  ${times.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
                <span class="err" id="timeErr"></span>
              </div>
            </div>
            <div class="form-group">
              <label for="guests">Number of Guests *</label>
              <select id="guests" name="guests" required>
                <option value="">Select guests</option>
                ${[1,2,3,4,5,6,7,8].map(n => `<option value="${n}">${n} guest${n>1?'s':''}</option>`).join('')}
              </select>
              <span class="err" id="guestsErr"></span>
            </div>
            <div class="form-group">
              <label for="notes">Special Requests</label>
              <textarea id="notes" name="notes" rows="3" placeholder="Allergies, celebrations, accessibility needs..."></textarea>
            </div>
            <button type="submit" class="btn-primary btn-full" id="submitBtn">Confirm Reservation</button>
          </form>

          <div id="successMsg" class="success-msg" style="display:none">
            <div class="success-icon">&#10003;</div>
            <h3>Reservation Confirmed!</h3>
            <p>Thank you! We have received your booking and look forward to welcoming you.</p>
            <a href="/" class="btn-outline">Back to Home</a>
          </div>
        </div>
      </div>
    </div>
  </section>
</main>
${footer()}
<script src="/js/main.js"></script>
<script>
  document.getElementById('date').min = new Date().toISOString().split('T')[0];

  document.getElementById('resForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    let valid = true;
    const checks = [
      { id:'name',   err:'nameErr',   msg:'Please enter your name' },
      { id:'phone',  err:'phoneErr',  msg:'Please enter your phone number' },
      { id:'date',   err:'dateErr',   msg:'Please select a date' },
      { id:'time',   err:'timeErr',   msg:'Please select a time' },
      { id:'guests', err:'guestsErr', msg:'Please select number of guests' },
    ];
    checks.forEach(function(c) {
      var el = document.getElementById(c.id);
      var errEl = document.getElementById(c.err);
      if (!el.value.trim()) { errEl.textContent = c.msg; el.classList.add('invalid'); valid = false; }
      else { errEl.textContent = ''; el.classList.remove('invalid'); }
    });
    if (!valid) return;

    var btn = document.getElementById('submitBtn');
    btn.textContent = 'Submitting...';
    btn.disabled = true;

    try {
      var res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:   document.getElementById('name').value,
          phone:  document.getElementById('phone').value,
          email:  document.getElementById('email').value,
          date:   document.getElementById('date').value,
          time:   document.getElementById('time').value,
          guests: document.getElementById('guests').value,
          notes:  document.getElementById('notes').value
        })
      });
      if (res.ok) {
        document.getElementById('resForm').style.display = 'none';
        document.getElementById('successMsg').style.display = 'flex';
      } else { throw new Error(); }
    } catch(err) {
      btn.textContent = 'Confirm Reservation';
      btn.disabled = false;
      alert('Something went wrong. Please try again.');
    }
  });
</script>
</body></html>`);
  });

  // CONTACT PAGE
  app.get('/contact', (_req, res) => {
    res.send(`${head('Contact', 'Get in touch with Yummy UK. Find us in Kensington, London. Call, email or visit us today.')}
${nav('contact')}
<main>
  <section class="page-hero page-hero--contact">
    <div class="page-hero-overlay"></div>
    <div class="page-hero-content">
      <span class="section-label">Get In Touch</span>
      <h1>Contact Us</h1>
      <p>We would love to hear from you</p>
    </div>
  </section>

  <section class="contact-section">
    <div class="container">
      <div class="contact-grid">
        <div class="contact-info">
          <h2>Visit Us</h2>
          <div class="contact-item">
            <div class="contact-icon">&#128205;</div>
            <div><h4>Address</h4><p>42 Kensington High Street<br>London, W8 4PT</p></div>
          </div>
          <div class="contact-item">
            <div class="contact-icon">&#128222;</div>
            <div><h4>Phone</h4><p><a href="tel:+442079460123">+44 20 7946 0123</a></p></div>
          </div>
          <div class="contact-item">
            <div class="contact-icon">&#9993;</div>
            <div><h4>Email</h4><p><a href="mailto:hello@yummyuk.co.uk">hello@yummyuk.co.uk</a></p></div>
          </div>
          <div class="contact-item">
            <div class="contact-icon">&#128336;</div>
            <div><h4>Hours</h4><p>Mon&ndash;Fri: 12pm &ndash; 11pm<br>Sat&ndash;Sun: 11am &ndash; 11:30pm</p></div>
          </div>
          <a href="/reservation" class="btn-primary" style="margin-top:2rem;display:inline-block">Book a Table</a>
        </div>

        <div class="contact-form-wrap">
          <h2>Send a Message</h2>
          <form id="contactForm" novalidate>
            <div class="form-group">
              <label for="cname">Name *</label>
              <input type="text" id="cname" required placeholder="Your name">
            </div>
            <div class="form-group">
              <label for="cemail">Email *</label>
              <input type="email" id="cemail" required placeholder="your@email.com">
            </div>
            <div class="form-group">
              <label for="csubject">Subject</label>
              <input type="text" id="csubject" placeholder="How can we help?">
            </div>
            <div class="form-group">
              <label for="cmessage">Message *</label>
              <textarea id="cmessage" rows="5" required placeholder="Tell us more..."></textarea>
            </div>
            <button type="submit" class="btn-primary btn-full" id="contactBtn">Send Message</button>
          </form>
          <div id="contactSuccess" class="success-msg" style="display:none">
            <div class="success-icon">&#10003;</div>
            <h3>Message Sent!</h3>
            <p>Thanks for reaching out. We will get back to you within 24 hours.</p>
          </div>
        </div>
      </div>

      <div class="map-wrap">
        <iframe
          src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2483.5!2d-0.1929!3d51.5005!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x48760ffef88ad2a3%3A0x1e5e5c1e3f7e9f1!2sKensington%20High%20St%2C%20London!5e0!3m2!1sen!2suk!4v1700000000000"
          width="100%" height="360" style="border:0;border-radius:12px" allowfullscreen loading="lazy">
        </iframe>
      </div>
    </div>
  </section>
</main>
${footer()}
<script src="/js/main.js"></script>
<script>
  document.getElementById('contactForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = document.getElementById('contactBtn');
    btn.textContent = 'Sending...';
    btn.disabled = true;
    setTimeout(function() {
      document.getElementById('contactForm').style.display = 'none';
      document.getElementById('contactSuccess').style.display = 'flex';
    }, 700);
  });
</script>
</body></html>`);
  });

  // ── API ───────────────────────────────────────────────────────────────────
  app.post('/api/reservations', (req, res) => {
    const { name, phone, email, date, time, guests, notes } = req.body;
    if (!name || !phone || !date || !time || !guests) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    db.run(
      'INSERT INTO reservations (name,phone,email,date,time,guests,notes) VALUES (?,?,?,?,?,?,?)',
      [name, phone, email||'', date, time, parseInt(guests), notes||'']
    );
    res.json({ success: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ADMIN
  // ─────────────────────────────────────────────────────────────────────────
  const aHead = (title) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} &ndash; Yummy UK Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/admin.css">
</head><body>`;

  const aNn = () => `
<nav class="admin-nav">
  <div class="admin-nav-inner">
    <a href="/admin" class="admin-logo">Yummy <span>UK</span> Admin</a>
    <div class="admin-nav-links">
      <a href="/admin">Dashboard</a>
      <a href="/admin/menu">Menu</a>
      <a href="/admin/reservations">Reservations</a>
      <a href="/admin/logout" class="logout-btn">Log Out</a>
    </div>
  </div>
</nav>`;

  app.get('/admin/login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin');
    res.send(`${aHead('Login')}
<div class="admin-login-page">
  <div class="login-card">
    <div class="login-logo">Yummy <span>UK</span></div>
    <h2>Admin Panel</h2>
    ${req.query.err ? '<p class="login-err">Invalid username or password.</p>' : ''}
    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label>Username</label>
        <input type="text" name="username" required autofocus placeholder="admin">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" name="password" required placeholder="admin123">
      </div>
      <button type="submit" class="btn-admin-primary btn-full">Sign In</button>
    </form>
    <p class="login-hint">Default credentials: admin / admin123</p>
  </div>
</div></body></html>`);
  });

  app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.get('SELECT * FROM admin_users WHERE username = ?', [username]);
    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.admin = { id: user.id, username: user.username };
      return res.redirect('/admin');
    }
    res.redirect('/admin/login?err=1');
  });

  app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
  });

  app.get('/admin', requireAuth, (req, res) => {
    const { c: menuCount } = db.get('SELECT COUNT(*) as c FROM menu_items') || { c: 0 };
    const { c: resCount  } = db.get('SELECT COUNT(*) as c FROM reservations') || { c: 0 };
    const today = new Date().toISOString().slice(0,10);
    const { c: todayCount } = db.get(`SELECT COUNT(*) as c FROM reservations WHERE date='${today}'`) || { c: 0 };
    const upcoming = db.all(`SELECT * FROM reservations WHERE date>='${today}' ORDER BY date,time LIMIT 5`);

    res.send(`${aHead('Dashboard')}${aNn()}
<main class="admin-main">
  <div class="admin-header">
    <div><h1>Dashboard</h1><p>Welcome back, ${req.session.admin.username}</p></div>
  </div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-num">${menuCount}</div><div class="stat-label">Menu Items</div></div>
    <div class="stat-card"><div class="stat-num">${resCount}</div><div class="stat-label">Total Reservations</div></div>
    <div class="stat-card stat-accent"><div class="stat-num">${todayCount}</div><div class="stat-label">Today's Bookings</div></div>
  </div>
  <div class="admin-card">
    <h2>Upcoming Reservations</h2>
    <table class="admin-table">
      <thead><tr><th>Name</th><th>Date</th><th>Time</th><th>Guests</th><th>Phone</th></tr></thead>
      <tbody>
        ${upcoming.length
          ? upcoming.map(r => `<tr>
              <td>${r.name}</td><td>${r.date}</td><td>${r.time}</td>
              <td>${r.guests}</td><td>${r.phone}</td>
            </tr>`).join('')
          : '<tr><td colspan="5" style="text-align:center;color:#bbb;padding:1.5rem">No upcoming reservations</td></tr>'}
      </tbody>
    </table>
    <a href="/admin/reservations" class="btn-admin-outline">View All &rarr;</a>
  </div>
</main></body></html>`);
  });

  app.get('/admin/menu', requireAuth, (req, res) => {
    const items = db.all('SELECT * FROM menu_items ORDER BY category, id');
    const msg   = req.query.msg;
    res.send(`${aHead('Menu')}${aNn()}
<main class="admin-main">
  <div class="admin-header">
    <h1>Menu Management</h1>
    <a href="/admin/menu/add" class="btn-admin-primary">+ Add Item</a>
  </div>
  ${msg==='added'   ? '<div class="alert alert-success">Item added successfully!</div>'   : ''}
  ${msg==='updated' ? '<div class="alert alert-success">Item updated successfully!</div>' : ''}
  ${msg==='deleted' ? '<div class="alert alert-success">Item deleted.</div>'              : ''}
  <div class="admin-card">
    <table class="admin-table">
      <thead><tr><th>Image</th><th>Name</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${items.map(item => `
        <tr>
          <td><img src="${item.image}" style="width:52px;height:52px;object-fit:cover;border-radius:6px" onerror="this.src='/images/default-food.jpg'"></td>
          <td><strong>${item.name}</strong><br><small style="color:#aaa">${String(item.description||'').slice(0,55)}&hellip;</small></td>
          <td><span class="badge">${item.category}</span></td>
          <td>&pound;${Number(item.price).toFixed(2)}</td>
          <td><span class="badge ${item.available ? 'badge-green':'badge-red'}">${item.available ? 'Active':'Hidden'}</span></td>
          <td class="actions">
            <a href="/admin/menu/edit/${item.id}" class="btn-admin-sm">Edit</a>
            <form method="POST" action="/admin/menu/delete/${item.id}" style="display:inline" onsubmit="return confirm('Delete this item?')">
              <button type="submit" class="btn-admin-sm btn-danger">Delete</button>
            </form>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</main></body></html>`);
  });

  const menuForm = (item = {}) => `
<form method="POST" action="${item.id ? `/admin/menu/edit/${item.id}` : '/admin/menu/add'}" enctype="multipart/form-data" class="admin-form">
  <div class="form-grid">
    <div class="form-group">
      <label>Item Name *</label>
      <input type="text" name="name" value="${item.name||''}" required>
    </div>
    <div class="form-group">
      <label>Category *</label>
      <select name="category" required>
        ${['starters','mains','desserts'].map(c =>
          `<option value="${c}" ${item.category===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`
        ).join('')}
      </select>
    </div>
  </div>
  <div class="form-group">
    <label>Description</label>
    <textarea name="description" rows="2">${item.description||''}</textarea>
  </div>
  <div class="form-grid">
    <div class="form-group">
      <label>Price (&pound;) *</label>
      <input type="number" name="price" value="${Number(item.price||0).toFixed(2)}" step="0.01" min="0" required>
    </div>
    <div class="form-group">
      <label>Status</label>
      <select name="available">
        <option value="1" ${item.available!==0?'selected':''}>Active (visible)</option>
        <option value="0" ${item.available===0?'selected':''}>Hidden</option>
      </select>
    </div>
  </div>
  <div class="form-group">
    <label>Image URL <small style="color:#999">(paste Unsplash or any URL)</small></label>
    <input type="text" name="image_url" value="${item.image||''}" placeholder="https://...">
  </div>
  <div class="form-group">
    <label>Or Upload Image <small style="color:#999">(overrides URL if selected)</small></label>
    <input type="file" name="image" accept="image/*">
  </div>
  <div class="form-actions">
    <a href="/admin/menu" class="btn-admin-outline">Cancel</a>
    <button type="submit" class="btn-admin-primary">${item.id ? 'Update Item' : 'Add Item'}</button>
  </div>
</form>`;

  app.get('/admin/menu/add', requireAuth, (_req, res) => {
    res.send(`${aHead('Add Item')}${aNn()}
<main class="admin-main">
  <div class="admin-header"><h1>Add Menu Item</h1></div>
  <div class="admin-card">${menuForm()}</div>
</main></body></html>`);
  });

  app.post('/admin/menu/add', requireAuth, upload.single('image'), (req, res) => {
    const { name, description, price, category, available, image_url } = req.body;
    const image = req.file
      ? `/images/${req.file.filename}`
      : (image_url && image_url.trim() ? image_url : '/images/default-food.jpg');
    db.run(
      'INSERT INTO menu_items (name,description,price,category,available,image) VALUES (?,?,?,?,?,?)',
      [name, description||'', parseFloat(price), category, parseInt(available), image]
    );
    res.redirect('/admin/menu?msg=added');
  });

  app.get('/admin/menu/edit/:id', requireAuth, (req, res) => {
    const item = db.get('SELECT * FROM menu_items WHERE id=?', [req.params.id]);
    if (!item) return res.redirect('/admin/menu');
    res.send(`${aHead('Edit Item')}${aNn()}
<main class="admin-main">
  <div class="admin-header"><h1>Edit Menu Item</h1></div>
  <div class="admin-card">${menuForm(item)}</div>
</main></body></html>`);
  });

  app.post('/admin/menu/edit/:id', requireAuth, upload.single('image'), (req, res) => {
    const { name, description, price, category, available, image_url } = req.body;
    const existing = db.get('SELECT image FROM menu_items WHERE id=?', [req.params.id]);
    const image = req.file
      ? `/images/${req.file.filename}`
      : (image_url && image_url.trim() ? image_url : (existing ? existing.image : '/images/default-food.jpg'));
    db.run(
      'UPDATE menu_items SET name=?,description=?,price=?,category=?,available=?,image=? WHERE id=?',
      [name, description||'', parseFloat(price), category, parseInt(available), image, req.params.id]
    );
    res.redirect('/admin/menu?msg=updated');
  });

  app.post('/admin/menu/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM menu_items WHERE id=?', [req.params.id]);
    res.redirect('/admin/menu?msg=deleted');
  });

  app.get('/admin/reservations', requireAuth, (req, res) => {
    const filter = req.query.filter || 'all';
    const today  = new Date().toISOString().slice(0,10);
    let rows;
    if (filter === 'today') {
      rows = db.all(`SELECT * FROM reservations WHERE date='${today}' ORDER BY time`);
    } else if (filter === 'upcoming') {
      rows = db.all(`SELECT * FROM reservations WHERE date>='${today}' ORDER BY date,time`);
    } else {
      rows = db.all('SELECT * FROM reservations ORDER BY date DESC, time DESC');
    }

    res.send(`${aHead('Reservations')}${aNn()}
<main class="admin-main">
  <div class="admin-header"><h1>Reservations</h1></div>
  <div class="filter-bar">
    <a href="?filter=all"      class="filter-btn ${filter==='all'     ?'active':''}">All (${db.get('SELECT COUNT(*) as c FROM reservations').c})</a>
    <a href="?filter=upcoming" class="filter-btn ${filter==='upcoming'?'active':''}">Upcoming</a>
    <a href="?filter=today"    class="filter-btn ${filter==='today'   ?'active':''}">Today</a>
  </div>
  <div class="admin-card">
    <table class="admin-table">
      <thead>
        <tr><th>Name</th><th>Date</th><th>Time</th><th>Guests</th><th>Phone</th><th>Email</th><th>Notes</th><th>Booked</th><th></th></tr>
      </thead>
      <tbody>
        ${rows.length
          ? rows.map(r => `
          <tr>
            <td><strong>${r.name}</strong></td>
            <td>${r.date}</td>
            <td>${r.time}</td>
            <td>${r.guests}</td>
            <td>${r.phone}</td>
            <td>${r.email||'&ndash;'}</td>
            <td style="max-width:140px;font-size:0.82rem;color:#999">${r.notes||'&ndash;'}</td>
            <td style="font-size:0.8rem;color:#ccc">${String(r.created_at||'').slice(0,10)}</td>
            <td>
              <form method="POST" action="/admin/reservations/delete/${r.id}" style="display:inline" onsubmit="return confirm('Delete this reservation?')">
                <button class="btn-admin-sm btn-danger">Delete</button>
              </form>
            </td>
          </tr>`).join('')
          : '<tr><td colspan="9" style="text-align:center;color:#bbb;padding:2rem">No reservations found</td></tr>'}
      </tbody>
    </table>
  </div>
</main></body></html>`);
  });

  app.post('/admin/reservations/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM reservations WHERE id=?', [req.params.id]);
    res.redirect('/admin/reservations');
  });

  // ─────────────────────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`\n  Yummy UK is running`);
    console.log(`  Website :  http://localhost:${PORT}`);
    console.log(`  Admin   :  http://localhost:${PORT}/admin/login`);
    console.log(`  Login   :  admin / admin123\n`);
  });
}

boot().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
