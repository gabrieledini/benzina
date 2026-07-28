/**
 * /api/prezzi — fotografia del giorno per una provincia.
 * Scarica ~15 MB lato server e restituisce ~30 KB al client.
 */

import { leggiProvincia } from "../lib/mimit.mjs";

export const config = { path: "/api/prezzi" };

export default async (req) => {
  const url = new URL(req.url);
  const prov = (url.searchParams.get("prov") || process.env.PROVINCIA || "LU")
    .toUpperCase().slice(0, 2);

  let dati;
  try {
    dati = await leggiProvincia(prov);
  } catch (e) {
    return Response.json(
      { errore: "sorgente MIMIT non raggiungibile", dettaglio: String(e.message) },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!dati.prezzi.length) {
    return Response.json(
      { errore: `nessun impianto trovato per la provincia ${prov}` },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    { ...dati, epoch: "2020-01-01" },
    {
      headers: {
        "Cache-Control": "public, max-age=600",
        "Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400"
      }
    }
  );
};
