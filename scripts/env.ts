// Loads .env.local into process.env (like Next.js does), without printing anything.
export function loadEnv() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    console.warn("No .env.local found; using the current environment variables.");
  }
}
