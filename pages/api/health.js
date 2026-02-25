// pages/api/health.js — Health check endpoint for Timeweb Cloud
export default function handler(req, res) {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
}
