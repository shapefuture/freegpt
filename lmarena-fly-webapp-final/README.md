# LMArena Fly Webapp Final

A minimalist, Apple-inspired, production-ready Node.js webapp for LMArena model comparison, with dynamic model selectors, robust security, logging, accessibility, and full test/lint coverage.

---

## Features

- **Dynamic Model Selection**: UI fetches available models from `/api/models` (via Puppeteer UI scraping & fallback).
- **Express Backend**: `/api/chat`, `/api/models`, `/api/trigger-retry`, `/healthz` endpoints.
- **CAPTCHA fallback**: User-in-the-loop when Cloudflare/Turnstile challenge detected.
- **Security**: Helmet, CORS, rate limiting, production logging.
- **Accessibility**: Full ARIA, keyboard and mobile support, clean error handling.
- **Testing & Linting**: Jest, Supertest, ESLint, and Prettier.
- **Docker/Fly.io Ready**: Deploy with one command, includes `.env.example`.

---

## Usage

1. **Install dependencies**

   ```
   npm install
   ```

2. **Configure environment**

   - Copy `.env.example` to `.env` and fill in values if needed.

3. **Development**

   ```
   npm run dev
   ```

   Visit [http://localhost:3001](http://localhost:3001).

4. **Production**

   ```
   npm run build
   npm run start
   ```

---

## Endpoints

- `GET /api/models` — List available models (scrapes LMArena UI).
- `POST /api/chat` — Start a model-vs-model chat (SSE stream).
- `POST /api/trigger-retry` — Retry after CAPTCHA/user action.
- `GET /healthz` — Health check (for Fly.io/Docker).
- All static assets and error pages served from `/public`.

---

## Testing

- **Unit/API**

  ```
  npm run test
  ```

- **Lint**

  ```
  npm run lint       # Check all code for lint errors/warnings
  npm run lint:fix   # Auto-fix lintable errors
  ```

- **Format**

  ```
  npm run format     # Format all JS files with Prettier
  ```

---

## Deployment

- Build with Docker or deploy to Fly.io using the included `fly.toml` and Dockerfile.
- Expects Google Chrome and Puppeteer dependencies for real browser automation.

---

## Developer Notes

- **Model Selectors**: If the LMArena UI changes, update the selectors in `src/puppeteerManager.js` (see comments).
- **Analytics**: By default, analytics is stubbed (console log). Integrate your preferred system in `public/script.js`.
- **Logging**: Production logs are written to `logs/app.log` (via Winston). Customize as needed.
- **Further Improvements**: See comments in code for optional TypeScript migration, session management, or advanced error handling.

---