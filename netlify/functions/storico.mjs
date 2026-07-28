/**
 * /api/storico?prov=LU&carb=Benzina&self=1&giorni=30
 *
 * Restituisce la serie giornaliera reale, una riga per bandiera.
 * Lo storico non esiste a monte: il MIMIT pubblica solo la fotografia del
 * giorno e l'archivio trimestrale è indietro di mesi. Quindi lo costruiamo noi,
 * un punto al giorno su Netlify Blobs.
 *
 * Se il punto di oggi manca, questa funzione lo calcola e lo salva: così lo
 * storico si alimenta anche solo visitando il sito, senza dipendere solo dal
 * cron. Ogni giorno pesa qualche KB.
 */

import { getStore } from "@netlify/blobs";
import { leggiProvincia, aggrega, isoOggi } from "../lib/mimit.mjs";

export const config = { path: "/api/storico" };

const chiave = (prov, iso) => `${prov}/${iso}`;

export default async (req) => {
  const url = new URL(req.url);
  const prov   = (url.searchParams.get("prov") || process.env.PROVINCIA || "LU").toUpperCase().slice(0, 2);
  const carb   = url.searchParams.get("carb") || "Benzina";
  const self   = url.searchParams.get("self") === "0" ? 0 : 1;
  const giorni = Math.min(90, Math.max(7, +(url.searchParams.get("giorni") || 30)));

  const store = getStore({ name: "storico-carburanti", consistency: "strong" });
  const oggi = isoOggi();
  let scritto = false;

  /* il punto di oggi manca? lo calcolo e lo conservo */
  try {
    const presente = await store.get(chiave(prov, oggi));
    if (!presente) {
      const snap = aggrega(await leggiProvincia(prov));
      if (Object.keys(snap.serie).length) {
        await store.setJSON(chiave(prov, oggi), { data: oggi, ...snap });
        scritto = true;
      }
    }
  } catch (e) {
    /* se il MIMIT è giù si prosegue con quello che c'è in archivio */
    console.warn("snapshot di oggi non scritta:", e.message);
  }

  /* raccolta delle date da leggere */
  const date = [];
  for (let i = 0; i < giorni; i++) {
    date.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  }

  const letti = await Promise.all(
    date.map(d => store.get(chiave(prov, d), { type: "json" }).catch(() => null))
  );

  /* trasposizione: da un blob al giorno a una serie per bandiera */
  const serie = {};
  const bandiere = new Set();
  const punti = [];

  letti.forEach((g, i) => {
    if (!g || !g.serie) return;
    const voce = { d: date[i], b: {} };
    for (const [k, v] of Object.entries(g.serie)) {
      const [bandiera, c, s] = k.split("|");
      if (c !== carb || +s !== self) continue;
      voce.b[bandiera] = { m: v.m, n: v.n };
      bandiere.add(bandiera);
    }
    if (Object.keys(voce.b).length) punti.push(voce);
  });

  punti.sort((a, b) => a.d.localeCompare(b.d));
  for (const bandiera of bandiere) {
    serie[bandiera] = punti
      .filter(p => p.b[bandiera])
      .map(p => ({ d: p.d, m: p.b[bandiera].m, n: p.b[bandiera].n }));
  }

  return Response.json(
    { provincia: prov, carburante: carb, self, giorni: punti.length, scritto, serie },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Netlify-CDN-Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400"
      }
    }
  );
};
