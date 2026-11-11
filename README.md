# Resume Analyzer

A small, locally hosted resume analyzer. It sends resume content and an optional job description to Google's Gemini API, displays the resulting feedback, and stores each successful analysis in a local SQLite database.

## Requirements

- Node.js 18 or newer (the server uses Node's built-in `fetch`)
- npm
- A Gemini API key to run resume analyses
- An internet connection for Gemini requests and externally hosted browser assets

## Run locally on Windows

1. Open PowerShell in this project folder.
2. Install the dependencies:

   ```powershell
   npm install
   ```

3. Set your Gemini API key in the current PowerShell window:

   ```powershell
   $env:GEMINI_API_KEY = "your-gemini-api-key"
   ```

   This keeps the key out of the source files. Set it again in a new terminal window before starting the server there.

4. Start the server:

   ```powershell
   npm start
   ```

5. Open the URL printed by the server, normally <http://localhost:3000>.
   - Analyzer: <http://localhost:3000/>
   - Saved history: <http://localhost:3000/history.html>

The server binds to `127.0.0.1`. If port 3000 is already occupied, it tries the next port and prints the URL to use.

## Use the analyzer

1. Enter a candidate name and, optionally, a job title.
2. Choose a resume file and optionally paste or upload a job description.
3. Choose an available Gemini model and click **Analyze resume**.
4. Review the feedback. When it is saved successfully, the status reads **Analysis saved to history.**
5. Use the **History** page to search by candidate, job title, or summary, and filter by overall score.

The file picker lists PDF, DOCX, TXT, Markdown, and common image formats. The selected model and candidate/job fields are remembered in this browser using `localStorage`; they are not saved to SQLite as preferences.

## How storage works

The backend creates `resume_history.db` in the project folder when the server starts. It initializes an `analyses` table if needed. Each saved record includes the candidate name, job title, overall and ATS scores, a summary, the full analysis JSON, and a creation timestamp.

To confirm records were saved, check the success status and History page, or query the SQLite database directly. If you have the SQLite command-line tool installed, run this from the project folder:

```powershell
sqlite3 .\resume_history.db "SELECT id, candidate_name, created_at FROM analyses ORDER BY id DESC LIMIT 10;"
```

You can also open `resume_history.db` with a SQLite viewer such as DB Browser for SQLite and run:

```sql
SELECT id, candidate_name, created_at
FROM analyses
ORDER BY id DESC
LIMIT 10;
```

The `/api/health` endpoint reports that the server is responding and includes the database path:

```text
http://localhost:3000/api/health
```

## Run the pages individually

The HTML files are served by `server.js`; they are not standalone apps when opened as `file://` pages. Their API requests (`/api/...`) need the server running.

- To use the analyzer by itself, start the server and open `/`.
- To use saved history by itself, start the server and open `/history.html`.

The analyzer requires `GEMINI_API_KEY` for model loading and analysis. History can be viewed without a Gemini key, as long as the server and database are available.

## API endpoints

- `GET /api/health` — server/database health information
- `GET /api/config` — whether the server has a Gemini key configured
- `GET /api/models` — Gemini models available to the configured key
- `POST /api/analyze` — requests analysis from Gemini
- `GET /api/analyses` — lists saved analyses; supports `search`, `minScore`, and `maxScore` query parameters
- `POST /api/analyses` — saves an analysis to SQLite

## Project files

- `server.js` — Express server, Gemini API proxy, and SQLite setup/read/write routes
- `resume-analyzer.html` — analyzer interface and analysis display
- `history.html` — searchable and score-filtered saved history
- `resume_history.db` — local SQLite database, created or updated by the server
- `package.json` — npm scripts and dependencies
