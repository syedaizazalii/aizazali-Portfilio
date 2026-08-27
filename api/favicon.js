// /api/favicon — serves the current site icon from a STABLE url.
// Google (and other crawlers) prefer a fixed, non-JS-dependent URL for the
// favicon shown in search results, so this endpoint stays constant even
// though the underlying image (set from the admin panel) can change anytime.
//
// Flow on every request:
//   1. Ask Supabase for the current favicon_url (from the `settings` table)
//   2. Fetch that image and stream its bytes + correct Content-Type back
//   3. If anything fails (no value set, fetch error, etc.) -> redirect to
//      the static /favicon.png that ships with the site, so there's always
//      a valid icon.

module.exports = async (req, res) => {
  const FALLBACK_PATH = "/favicon.png";

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars");
    }

    // 1. Look up the current favicon_url from the settings table
    const settingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?key=eq.favicon_url&select=value`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!settingsRes.ok) {
      throw new Error(`settings query failed: ${settingsRes.status}`);
    }

    const rows = await settingsRes.json();
    const iconUrl = rows && rows[0] && rows[0].value;

    if (!iconUrl) {
      throw new Error("favicon_url is not set yet");
    }

    // 2. Fetch the actual image and stream it back with the right headers
    const imageRes = await fetch(iconUrl);
    if (!imageRes.ok) {
      throw new Error(`icon image fetch failed: ${imageRes.status}`);
    }

    const contentType = imageRes.headers.get("content-type") || "image/png";
    const arrayBuffer = await imageRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    // Short cache: fresh enough that admin changes show up within ~1 minute,
    // but stable enough that Google isn't refetching on every single crawl.
    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
    );
    res.status(200).send(buffer);
  } catch (err) {
    // 3. Fallback — always resolve to *some* valid icon, never a broken image
    console.error("favicon function error:", err.message);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.writeHead(302, { Location: FALLBACK_PATH });
    res.end();
  }
};