# Frontend Connection Guide

## Backend API

**Base URL:** `/api` (relative to Next.js app)

### Endpoints

#### POST /api/scraped-data
Scrape and store URL data.

**Request:**
```json
{
  "url": "https://example.com"
}
```

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "url": "https://example.com",
    "title": "Example Domain",
    "description": "...",
    "h1": "...",
    "canonical": "https://example.com",
    "images": ["..."],
    "contentText": "...",
    "rawHtml": "...",
    "_id": "...",
    "createdAt": "..."
  }
}
```

**Response (cached):** 200
**Response (error):** 400, 502, 500

#### GET /api/scraped-data
List all stored data.

**Response:**
```json
{
  "ok": true,
  "data": [...]
}
```

## Usage Example

### Scrape a URL
```javascript
const response = await fetch('/api/scraped-data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com' })
});
const result = await response.json();
```

### Fetch & Display Gallery
```javascript
// Fetch all stored data
const response = await fetch('/api/scraped-data');
const { data } = await response.json();

// Display in gallery
const gallery = document.getElementById('gallery');
data.forEach(item => {
  const card = document.createElement('div');
  card.innerHTML = `
    <h3>${item.title || item.url}</h3>
    <p>${item.description || ''}</p>
    <div class="images">
      ${item.images.map(img => `<img src="${img}" />`).join('')}
    </div>
  `;
  gallery.appendChild(card);
});
```

### Response Structure (Gallery)
```json
{
  "ok": true,
  "data": [
    {
      "url": "https://example.com",
      "title": "Example Domain",
      "description": "...",
      "h1": "...",
      "canonical": "https://example.com",
      "images": [
        "data:image/jpeg;base64,/9j/..."
      ],
      "contentText": "...",
      "rawHtml": "...",
      "_id": "...",
      "createdAt": "2026-05-02T..."
    }
  ]
}
```

**Note:** Images are stored as base64 data URLs - use directly as `<img src="...">`