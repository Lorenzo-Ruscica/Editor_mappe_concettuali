/**
 * Vercel Serverless Function: GET /api/config
 * Restituisce al browser URL e chiave pubblica (anon/publishable) di Supabase
 * leggendoli dalle variabili d'ambiente del progetto Vercel.
 * La chiave service_role NON deve mai essere esposta qui.
 */
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();

  res.statusCode = 200;
  res.end(JSON.stringify({ supabaseUrl, supabaseAnonKey }));
};
