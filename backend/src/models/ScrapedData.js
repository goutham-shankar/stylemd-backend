const mongoose = require('mongoose');

const ScrapedSchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true, index: true },
  title: { type: String },
  description: { type: String },
  h1: { type: String },
  canonical: { type: String },
  images: { type: [String], default: [] },
  contentText: { type: String },
  rawHtml: { type: String },
  createdAt: { type: Date, default: () => new Date() },
}, { collection: 'scraped_data' });

module.exports = mongoose.models.ScrapedData || mongoose.model('ScrapedData', ScrapedSchema);
