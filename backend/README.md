# StyleMD Scraper Backend

Minimal backend that exposes POST `/scraped-data` to fetch, normalize, store, and return scraped data.

Quick start

1. Install dependencies

```bash
cd backend
npm install
```

2. Copy `.env.example` to `.env` (or set `MONGO_URI` and `PORT` in env)

3. Run

```bash
npm start
```

Endpoint

- `POST /scraped-data` - body `{ "url": "https://example.com" }`
- Response: `{ ok: true, data: { _id, url, title, ... } }`

Notes

- The service checks MongoDB first to avoid duplicate scrapes.
- Uses a short in-memory cache to avoid concurrent duplicate work.
- Scraper performs a small set of extractions: title, description, h1, canonical, images, and page text.
