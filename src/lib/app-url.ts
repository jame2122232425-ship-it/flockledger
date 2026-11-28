export function getAppUrl() {
  const configuredUrl = process.env.VERCEL_ENV === "production"
    ? "https://flockledgerupdated.vercel.app"
    : process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configuredUrl) return null;

  try {
    const url = new URL(configuredUrl);
    const localHttp = url.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
