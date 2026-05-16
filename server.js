const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS news (
        id SERIAL PRIMARY KEY,
        headline TEXT NOT NULL,
        content TEXT,
        category TEXT DEFAULT 'other',
        ticker TEXT,
        high_alert BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS imbalances (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        sp500 BIGINT,
        nasdaq BIGINT,
        dow30 BIGINT,
        mag7 BIGINT,
        claude_analysis TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS digest (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        headlines TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cftc (
        id SERIAL PRIMARY KEY,
        week_ending DATE,
        data JSONB,
        claude_analysis TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

// ==================== NEWS ====================

// GET latest news
app.get('/api/news', async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const category = req.query.category;
    
    let query = 'SELECT * FROM news';
    let params = [];
    
    if (category && category !== 'all') {
      query += ' WHERE category = $1';
      params.push(category);
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST new news item (called from n8n)
app.post('/api/news', async (req, res) => {
  try {
    const { headline, content, category, ticker, high_alert } = req.body;
    const result = await pool.query(
      'INSERT INTO news (headline, content, category, ticker, high_alert) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [headline, content || null, category || 'other', ticker || null, high_alert || false]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== IMBALANCES ====================

// GET imbalances
app.get('/api/imbalances', async (req, res) => {
  try {
    const limit = req.query.limit || 10;
    const type = req.query.type;
    
    let query = 'SELECT * FROM imbalances';
    let params = [];
    
    if (type) {
      query += ' WHERE type = $1';
      params.push(type.toUpperCase());
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET today's imbalances
app.get('/api/imbalances/today', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM imbalances WHERE created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC"
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST new imbalance (called from n8n)
app.post('/api/imbalances', async (req, res) => {
  try {
    const { type, sp500, nasdaq, dow30, mag7, claude_analysis } = req.body;
    const result = await pool.query(
      'INSERT INTO imbalances (type, sp500, nasdaq, dow30, mag7, claude_analysis) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [type.toUpperCase(), sp500 || 0, nasdaq || 0, dow30 || 0, mag7 || 0, claude_analysis || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== DIGEST ====================

// GET latest digest
app.get('/api/digest', async (req, res) => {
  try {
    const limit = req.query.limit || 7;
    const result = await pool.query(
      'SELECT * FROM digest ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST new digest (called from n8n)
app.post('/api/digest', async (req, res) => {
  try {
    const { content, headlines } = req.body;
    const result = await pool.query(
      'INSERT INTO digest (content, headlines) VALUES ($1, $2) RETURNING *',
      [content, headlines || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== CFTC ====================

// GET latest CFTC
app.get('/api/cftc', async (req, res) => {
  try {
    const limit = req.query.limit || 4;
    const result = await pool.query(
      'SELECT * FROM cftc ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST new CFTC data (called from n8n)
app.post('/api/cftc', async (req, res) => {
  try {
    const { week_ending, data, claude_analysis } = req.body;
    const result = await pool.query(
      'INSERT INTO cftc (week_ending, data, claude_analysis) VALUES ($1, $2, $3) RETURNING *',
      [week_ending || null, JSON.stringify(data || {}), claude_analysis || null]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`InstantNews API running on port ${PORT}`);
  await initDB();
});
