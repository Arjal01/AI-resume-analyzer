const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const dbPath = path.join(__dirname, 'resume_history.db');
const geminiApiKey = process.env.GEMINI_API_KEY;

function startServer(port) {
  const server = app.listen(port, HOST, () => {
    console.log(`Resume Analyzer server is running at http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Retrying on port ${nextPort}...`);
      startServer(nextPort);
      return;
    }

    console.error('Server failed to start:', err.message);
    process.exit(1);
  });
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open SQLite database:', err.message);
    process.exit(1);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_name TEXT NOT NULL,
      job_title TEXT,
      overall_score INTEGER,
      ats_score INTEGER,
      summary TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      result_json TEXT NOT NULL
    );
  `, (execErr) => {
    if (execErr) {
      console.error('Failed to initialize SQLite schema:', execErr.message);
      process.exit(1);
    }
    console.log('SQLite database ready at', dbPath);
  });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'resume-analyzer.html'));
});

app.get('/history.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'history.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: dbPath });
});

app.get('/api/config', (_req, res) => {
  res.json({ geminiConfigured: Boolean(geminiApiKey) });
});

app.get('/api/models', async (_req, res) => {
  if (!geminiApiKey) {
    return res.status(503).json({ error: 'Set GEMINI_API_KEY before starting the server.' });
  }

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': geminiApiKey },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Unable to load Gemini models.',
      });
    }

    const models = (data.models || [])
      .filter((model) => model.name && model.supportedGenerationMethods?.includes('generateContent'))
      .map((model) => model.name.replace(/^models\//, ''))
      .filter((name) => /^gemini-[A-Za-z0-9._-]+$/.test(name))
      .sort();

    res.json({ models });
  } catch (err) {
    console.error('Gemini model request failed:', err.message);
    res.status(502).json({ error: 'Unable to connect to Gemini.' });
  }
});

app.post('/api/analyze', async (req, res) => {
  if (!geminiApiKey) {
    return res.status(503).json({ error: 'Set GEMINI_API_KEY before starting the server.' });
  }

  const { model, contents, generationConfig } = req.body || {};
  if (typeof model !== 'string' || !/^gemini-[A-Za-z0-9._-]+$/.test(model)) {
    return res.status(400).json({ error: 'A valid Gemini model is required.' });
  }
  if (!Array.isArray(contents) || contents.length === 0) {
    return res.status(400).json({ error: 'Analysis content is required.' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey,
        },
        body: JSON.stringify({ contents, generationConfig }),
      }
    );
    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Gemini analysis request failed:', err.message);
    res.status(502).json({ error: 'Unable to connect to Gemini.' });
  }
});

app.get('/api/analyses', (req, res) => {
  const search = String(req.query.search || '').trim();
  const minScore = Number(req.query.minScore ?? 0);
  const maxScore = Number(req.query.maxScore ?? 100);

  let sql = 'SELECT * FROM analyses WHERE 1 = 1';
  const params = [];

  if (search) {
    sql += ' AND (candidate_name LIKE ? OR job_title LIKE ? OR summary LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  if (!Number.isNaN(minScore)) {
    sql += ' AND overall_score >= ?';
    params.push(minScore);
  }

  if (!Number.isNaN(maxScore)) {
    sql += ' AND overall_score <= ?';
    params.push(maxScore);
  }

  sql += ' ORDER BY created_at DESC';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Database query failed:', err.message);
      return res.status(500).json({ error: 'Failed to load analysis history.' });
    }

    const payload = rows.map((row) => ({
      ...row,
      result: row.result_json ? JSON.parse(row.result_json) : null,
    }));

    res.json(payload);
  });
});

app.post('/api/analyses', (req, res) => {
  const { candidateName, jobTitle, result } = req.body || {};

  if (!candidateName || typeof candidateName !== 'string' || !candidateName.trim()) {
    return res.status(400).json({ error: 'Candidate name is required.' });
  }

  if (!result || typeof result !== 'object') {
    return res.status(400).json({ error: 'Analysis result is required.' });
  }

  const safeName = candidateName.trim();
  const safeTitle = typeof jobTitle === 'string' ? jobTitle.trim() : '';
  const summary = String(result.summary || '').slice(0, 500);
  const overallScore = Number(result.overall_score ?? result.overallScore ?? 0);
  const atsScore = Number(result.ats_score ?? result.atsScore ?? 0);
  const payload = JSON.stringify(result);

  const sql = `
    INSERT INTO analyses (candidate_name, job_title, overall_score, ats_score, summary, result_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.run(sql, [safeName, safeTitle, overallScore, atsScore, summary, payload], function (runErr) {
    if (runErr) {
      console.error('Database insert failed:', runErr.message);
      return res.status(500).json({ error: 'Failed to save analysis.' });
    }

    res.status(201).json({
      id: this.lastID,
      candidateName: safeName,
      jobTitle: safeTitle,
      overallScore,
      atsScore,
      summary,
    });
  });
});

startServer(DEFAULT_PORT);
