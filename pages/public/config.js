const ORIGIN = window.location.origin;
const LOCAL_WORKER = "http://127.0.0.1:8787";
const storedApiBase = window.localStorage.getItem("api_base_override");

function resolveApiBase() {
  if (storedApiBase) return storedApiBase;
  if (ORIGIN.includes("localhost:8080") || ORIGIN.includes("127.0.0.1:8080")) {
    return LOCAL_WORKER;
  }
  return ORIGIN;
}

window.APP_CONFIG = {
  SUPABASE_URL: "https://ljbfjlmtmaebexdwimhd.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqYmZqbG10bWFlYmV4ZHdpbWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczMzEwMTEsImV4cCI6MjA4MjkwNzAxMX0.gshTqKlaB_G0LmQO_iulGUhQZ7pMG_oR4_4mqGas_FI",
  API_BASE: resolveApiBase(),
};
