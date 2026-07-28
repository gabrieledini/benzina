/**
 * /api/prezzi — scarica i due CSV MIMIT lato server, tiene solo una provincia
 * e restituisce un JSON compatto (~30 KB al posto di ~15 MB).
 *
 * Risolve due problemi in un colpo: il CORS e il peso del download sul client.
 * La risposta resta in cache sulla CDN di Netlify per un'ora: i dati a monte
 * cambiano una volta al giorno, quindi la funzione gira pochissime volte.
 */

const ORIGIN = "https://www.mimit.gov.it/images/exportCSV/";
const EPOCH = Date.UTC(2020, 0, 1);

export const config = { path: "/api/prezzi" };

/* alias delle bandiere che nei dati compaiono con nomi diversi */
function normBrand(raw) {
  const b = (raw || "").trim(), U = b.toUpperCase();
  if (!b) return "";
  if (U.startsWith("Q8") || U.includes("KUWAIT")) return "Q8";
  if (U === "AGIP ENI" || U === "ENI" || U.startsWith("ENILIVE") || U.startsWith("ENIMOOV")) return "Eni";
  if (U === "API-IP" || U === "IP" || U === "ITALIANA PETROLI" || U === "ITALA PETROLI") return "IP";
  if (U === "POMPE BIANCHE") return "Pompe bianche";
  return b;
}

const titolo = s =>
  s.toLowerCase().replace(/(^|[\s'\-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

function dayNum(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s || "");
  return m ? Math.round((Date.UTC(+m[3], +m[2] - 1, +m[1]) - EPOCH) / 864e5) : -1;
}

async function scarica(file) {
  const res = await fetch(ORIGIN + file, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; osservaprezzi-locale/1.0)",
      "Accept": "text/csv,text/plain,*/*"
    }
  });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

export default async (req) => {
  const url = new URL(req.url);
  const prov = (url.searchParams.get("prov") || process.env.PROVINCIA || "LU")
    .toUpperCase().slice(0, 2);

  let anaTxt, przTxt;
  try {
    [anaTxt, przTxt] = await Promise.all([
      scarica("anagrafica_impianti_attivi.csv"),
      scarica("prezzo_alle_8.csv")
    ]);
  } catch (e) {
    return Response.json(
      { errore: "sorgente MIMIT non raggiungibile", dettaglio: String(e.message) },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  /* --- anagrafica: id|gestore|bandiera|tipo|nome|indirizzo|comune|prov|lat|lon
     alcuni nomi impianto contengono "|", quindi le code si leggono dal fondo --- */
  const anaRighe = anaTxt.split("\n");
  const estrazione = (anaRighe[0] || "").replace("Estrazione del", "").trim();
  const idx = new Map();          // idImpianto -> posizione
  const impianti = [];            // {n, c, b, lat, lon}

  for (let i = 2; i < anaRighe.length; i++) {
    const p = anaRighe[i].split("|");
    if (p.length < 10) continue;
    if (p[p.length - 3].trim().toUpperCase() !== prov) continue;
    const b = normBrand(p[2]);
    if (!b) continue;
    const lat = parseFloat(p[p.length - 2]), lon = parseFloat(p[p.length - 1]);
    idx.set(p[0], impianti.length);
    impianti.push({
      n: (p[4] || "").trim().slice(0, 60),
      c: titolo((p[p.length - 4] || "").trim()),
      b,
      lat: Number.isFinite(lat) ? +lat.toFixed(5) : null,
      lon: Number.isFinite(lon) ? +lon.toFixed(5) : null
    });
  }

  /* --- prezzi: id|carburante|prezzo|isSelf|dtComu --- */
  const przRighe = przTxt.split("\n");
  const estrazionePrezzi = (przRighe[0] || "").replace("Estrazione del", "").trim();
  const carburanti = [];
  const carbIdx = new Map();
  const prezzi = [];

  for (let i = 2; i < przRighe.length; i++) {
    const p = przRighe[i].split("|");
    if (p.length < 5) continue;
    const pos = idx.get(p[0]);
    if (pos === undefined) continue;
    const prezzo = parseFloat(p[2]);
    if (!(prezzo > 0.2 && prezzo < 5)) continue;   // scarta placeholder e refusi
    const carb = p[1].trim();
    let ci = carbIdx.get(carb);
    if (ci === undefined) { ci = carburanti.length; carburanti.push(carb); carbIdx.set(carb, ci); }
    prezzi.push([pos, ci, +prezzo.toFixed(3), p[3] === "1" ? 1 : 0, dayNum(p[4])]);
  }

  if (!prezzi.length) {
    return Response.json(
      { errore: `nessun impianto trovato per la provincia ${prov}` },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    { provincia: prov, estrazione: estrazionePrezzi || estrazione, epoch: "2020-01-01",
      carburanti, impianti, prezzi },
    {
      headers: {
        "Cache-Control": "public, max-age=600",
        "Netlify-CDN-Cache-Control": "public, durable, s-maxage=3600, stale-while-revalidate=86400"
      }
    }
  );
};
