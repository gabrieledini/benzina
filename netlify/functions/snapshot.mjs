/**
 * Funzione pianificata: alle 08:10 UTC salva la fotografia del giorno.
 *
 * Il MIMIT pubblica intorno alle 08:30 ora italiana; qui si gira poco dopo,
 * così lo storico ha un punto al giorno anche nei giorni in cui nessuno
 * apre il sito. /api/storico sa comunque rimediare da sé.
 *
 * Le province da seguire si impostano con la variabile d'ambiente PROVINCE
 * (elenco separato da virgole, es. "LU,MS,PI"). Senza, si limita a LU.
 */

import { getStore } from "@netlify/blobs";
import { leggiProvincia, aggrega, isoOggi } from "../lib/mimit.mjs";

export const config = { schedule: "10 8 * * *" };

export default async () => {
  const province = (process.env.PROVINCE || process.env.PROVINCIA || "LU")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

  const store = getStore({ name: "storico-carburanti", consistency: "strong" });
  const oggi = isoOggi();
  const esito = [];

  for (const prov of province) {
    try {
      const snap = aggrega(await leggiProvincia(prov));
      const voci = Object.keys(snap.serie).length;
      if (!voci) throw new Error("nessuna serie calcolabile");
      await store.setJSON(`${prov}/${oggi}`, { data: oggi, ...snap });
      esito.push(`${prov}: ${voci} serie`);
    } catch (e) {
      esito.push(`${prov}: errore ${e.message}`);
    }
  }

  console.log(`storico ${oggi} — ${esito.join(" · ")}`);
};
