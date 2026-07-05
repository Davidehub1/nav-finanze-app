import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Mancano VITE_SUPABASE_URL e/o VITE_SUPABASE_ANON_KEY. Crea un file .env.local (vedi .env.example)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
