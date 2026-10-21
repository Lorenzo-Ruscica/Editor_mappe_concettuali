/**
 * Vercel Serverless Function: GET /api/config
 * Restituisce al browser URL e chiave pubblica (anon/publishable) di Supabase
 * leggendoli dalle variabili d'ambiente del progetto Vercel.
 * La chiave service_role NON deve mai essere esposta qui.
 */
const DEFAULT_URL = 'https://btnotzqmdzobdcnbozuy.supabase.co';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0bm90enFtZHpvYmRjbmJvenV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MDY4MjIsImV4cCI6MjEwODE4MjgyMn0.wxF5x4ZK9yUKV1ROjjlXJq-hUHEyT05GzmS3gN3GOVY';

function cleanVal(v) {
  return String(v || '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, '');
}

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const supabaseUrl = cleanVal(process.env.SUPABASE_URL) || DEFAULT_URL;
  const supabaseAnonKey =
    cleanVal(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY) || DEFAULT_ANON_KEY;

  res.statusCode = 200;
  res.end(JSON.stringify({ supabaseUrl, supabaseAnonKey }));
};
