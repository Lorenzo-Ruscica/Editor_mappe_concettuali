/**
 * Configurazione di Supabase.
 *
 * In produzione su Vercel NON serve compilare questo file: l'app legge automaticamente
 * le variabili d'ambiente SUPABASE_URL e SUPABASE_ANON_KEY dalla funzione /api/config.
 *
 * Compilalo solo se vuoi provare il login in locale (es. con "npx serve" o Live Server).
 * La chiave "anon"/"publishable" è pubblica per natura: la sicurezza dei dati è garantita
 * dalle policy RLS del database. NON inserire mai qui la chiave "service_role"/"secret".
 */
window.CM_CONFIG = window.CM_CONFIG || {
  supabaseUrl: 'https://btnotzqmdzobdcnbozuy.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0bm90enFtZHpvYmRjbmJvenV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MDY4MjIsImV4cCI6MjEwODE4MjgyMn0.wxF5x4ZK9yUKV1ROjjlXJq-hUHEyT05GzmS3gN3GOVY'
};
