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
  supabaseUrl: '',      // es. 'https://abcdefghijklmno.supabase.co'
  supabaseAnonKey: ''   // es. 'eyJhbGciOi...' oppure 'sb_publishable_...'
};
