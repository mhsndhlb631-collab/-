export function deriveRuntimeDatabaseUrl(input: {
  migrationUrl: string;
  runtimePassword: string;
}) {
  const url = new URL(input.migrationUrl);
  if (
    !url.protocol.startsWith("postgres") ||
    !url.hostname.endsWith(".pooler.supabase.com") ||
    url.port !== "5432" ||
    !url.username.startsWith("postgres.") ||
    input.runtimePassword.length < 24
  ) {
    throw new Error("Invalid runtime database configuration");
  }
  const projectRef = decodeURIComponent(url.username).slice("postgres.".length);
  if (!/^[a-z0-9]{20}$/.test(projectRef))
    throw new Error("Invalid Supabase project reference");
  url.username = `tarbiyah_app_runtime.${projectRef}`;
  url.password = input.runtimePassword;
  url.port = "6543";
  url.search = "";
  url.hash = "";
  return url.toString();
}
