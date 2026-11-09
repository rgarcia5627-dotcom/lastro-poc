// Imported first by every script: loads .env.local / .env like Next.js does.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional
  }
}
