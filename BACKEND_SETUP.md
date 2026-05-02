# Backend Server Setup Guide

## Architecture Overview

The application now uses a **proper backend server** (Express) with the Next.js frontend acting as a proxy.

```
Client Request → Next.js (localhost:3000) → Backend (localhost:3001)
                      ↓
                /api/scraped-data (proxy)
                      ↓
          /scraped-data (actual handler)
                      ↓
                  MongoDB
```

## Running the Backend Server

### Prerequisites
- Node.js >= 18
- MongoDB connection (configured in backend)

### Start Backend Server

```bash
cd backend
npm install
npm run dev
```

Expected output:
```
[startup] booting backend on port 3001
[startup] connecting to mongo dbName=stylemd
[startup] connected to MongoDB
[startup] server listening on http://localhost:3001
```

### Verify Backend is Running

```bash
curl http://localhost:3001/health
# Response: {"ok":true,"status":"running"}
```

## Running the Frontend

### Start Next.js Frontend

```bash
npm install
npm run dev
```

Expected output:
```
  ▲ Next.js 15.3.1
  - Local:        http://localhost:3000
```

## Testing the Flow

### Test 1: Direct Backend Call (curl)

```bash
curl -X POST http://localhost:3001/scraped-data \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Response (201 on success):
```json
{
  "ok": true,
  "data": {
    "_id": "...",
    "url": "https://example.com",
    "title": "Example Domain",
    "description": "...",
    "images": ["data:image/jpeg;base64,..."],
    "contentText": "...",
    "rawHtml": "...",
    "createdAt": "2026-05-02T..."
  }
}
```

### Test 2: Via Frontend Proxy (curl)

```bash
curl -X POST http://localhost:3000/api/scraped-data \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Should return same response as Test 1 (proxied through Next.js).

### Test 3: Get All Data

```bash
# From backend directly
curl http://localhost:3001/scraped-data

# Via frontend proxy
curl http://localhost:3000/api/scraped-data
```

## Frontend Code Usage

Use the examples in [CONNECTION.md](./CONNECTION.md) - they remain unchanged:

```javascript
// Scrape a URL
const response = await fetch('/api/scraped-data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com' })
});
const result = await response.json();

// Get all data
const response = await fetch('/api/scraped-data');
const { data } = await response.json();
```

## Environment Variables

### Backend (.env in /backend)
```
PORT=3001
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/?appName=...
```

### Frontend (.env.local in root)
```
BACKEND_URL=http://localhost:3001
```

## Data Flow

1. **POST Request Flow:**
   - Client → `/api/scraped-data` (Next.js)
   - Next.js → `/scraped-data` (Backend)
   - Backend: Check file store → DB → cache → scrape → save to DB
   - Response: JSON with scraped data

2. **GET Request Flow:**
   - Client → `/api/scraped-data` (Next.js)
   - Next.js → `/scraped-data` (Backend)
   - Backend: Query MongoDB for all records
   - Response: JSON array of all scraped data

## Database Persistence

- Data is saved to MongoDB automatically on each successful scrape
- Backend checks DB before scraping to avoid duplicates
- In-memory cache (60s TTL) prevents concurrent duplicate work
- File store acts as backup/local cache

## Logs

### Backend Logs
```
[POST /scraped-data] processing url=...
[POST /scraped-data] db hit url=...        # Found in DB
[POST /scraped-data] scraping url=...      # Scraping started
[POST /scraped-data] success url=...       # Successfully saved
```

### Frontend Logs (Console)
```
[scraped-data-proxy] proxying POST to http://localhost:3001/scraped-data
[scraped-data-proxy] proxying GET to http://localhost:3001/scraped-data
```

## Troubleshooting

### Backend fails to connect to MongoDB
- Check `MONGO_URI` is correct
- Verify MongoDB is accessible from your network
- Check firewall rules

### Frontend can't reach backend
- Ensure backend is running on port 3001
- Check `BACKEND_URL` environment variable
- Frontend logs should show proxy errors

### Duplicate data or stale cache
- 60-second in-memory cache is active
- Clear file store: Remove `.playground/scraped-data.json`
- MongoDB stores persistent data - check there directly

## Next Steps

1. Start both servers (backend on 3001, frontend on 3000)
2. Test via curl to verify connectivity
3. Use frontend UI to test full flow
4. Check MongoDB to verify data persistence
