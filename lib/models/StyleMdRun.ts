import mongoose from 'mongoose';

const StyleMdRunSchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true, index: true },
  slug: { type: String, unique: true, index: true },
  provider: { type: String, default: 'kimi' },
  model: { type: String },
  runId: { type: String },
  styleMd: { type: String },
  screenshotUrl: { type: String }, // Legacy: File path URL
  screenshot: { type: String }, // New: Base64 encoded image data (data:image/png;base64,...)
  status: { type: String, default: 'completed' },
  createdAt: { type: Date, default: () => new Date() },
}, { collection: 'stylemd_runs' });

export const StyleMdRun = mongoose.models.StyleMdRun || mongoose.model('StyleMdRun', StyleMdRunSchema);