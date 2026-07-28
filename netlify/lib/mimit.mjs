/**
 * Codice condiviso fra le funzioni: scarica i CSV MIMIT, tiene una provincia,
 * e sa ridurre i listini a poche aggregazioni giornaliere.
 */

const ORIGIN = "https://www.mimit.gov.it/images/exportCSV/";
export const EPOCH = Date.UTC(2020, 0, 1);

export function normBrand(raw) {
  const b = (raw || "").trim(), U = b.toUpperCase();
  if (!b) return "";
  if (U.startsWith("Q8") || U.includes("KUWAIT")) return "Q8";
  if (U === "AGIP ENI" || U === "ENI" || U.startsWith("ENILIVE") || U.startsWith("ENIMOOV")) return "Eni";
  if (U === "API-IP" || U === "IP" || U === "ITALIANA PETROLI" || U === "ITALA PETROLI") return "IP";
  if (U === "POMPE BIANCHE") return "Pompe bianche";
  return b;
}

export const titolo = s =>
  s.toLowerCase().replace(/(^|[\s'\-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

export function dayNum(s) {
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

/**
 * Legge i due dataset e restituisce solo la provincia richiesta.
 * Attenzione: alcuni nomi impianto contengono "|", quindi nell'anagrafica
 * le colonne di coda si leggono dal fondo della riga.
 */
export async function leggiProvincia(prov) {
  const [anaTxt, przTxt] = await Promise.all([
    scarica("anagrafica_impianti_attivi.csv"),
    scarica("prezzo_alle_8.csv")
  ]);

  const anaRighe = anaTxt.split("\n");
  const idx = new Map();
  const impianti = [];

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

  const przRighe = przTxt.split("\n");
  const estrazione = (przRighe[0] || "").replace("Estrazione del", "").trim();
  const carburanti = [];
  const carbIdx = new Map();
  const prezzi = [];

  for (let i = 2; i < przRighe.length; i++) {
    const p = przRighe[i].split("|");
    if (p.length < 5) continue;
    const pos = idx.get(p[0]);
    if (pos === undefined) continue;
    const prezzo = parseFloat(p[2]);
    if (!(prezzo > 0.2 && prezzo < 5)) continue;
    const carb = p[1].trim();
    let ci = carbIdx.get(carb);
    if (ci === undefined) { ci = carburanti.length; carburanti.push(carb); carbIdx.set(carb, ci); }
    prezzi.push([pos, ci, +prezzo.toFixed(3), p[3] === "1" ? 1 : 0, dayNum(p[4])]);
  }

  return { provincia: prov, estrazione, carburanti, impianti, prezzi };
}

/**
 * Riduce la fotografia del giorno a una riga per bandiera × carburante × modalità.
 * La chiave "*" è la media di tutta la provincia, utile come riferimento.
 * Conta solo i listini comunicati negli ultimi 14 giorni: un prezzo fermo da
 * mesi non descrive il mercato di oggi.
 */
export function aggrega(dati, giorniValidi = 14) {
  const oggi = dati.estrazione
    ? Math.round((Date.parse(dati.estrazione) - EPOCH) / 864e5)
    : Math.round((Date.now() - EPOCH) / 864e5);

  const acc = new Map();
  const add = (k, v) => { const a = acc.get(k); if (a) a.push(v); else acc.set(k, [v]); };

  for (const [pi, ci, prezzo, self, giorno] of dati.prezzi) {
    if (giorno >= 0 && oggi - giorno > giorniValidi) continue;
    const carb = dati.carburanti[ci];
    add(`${dati.impianti[pi].b}|${carb}|${self}`, prezzo);
    add(`*|${carb}|${self}`, prezzo);
  }

  const serie = {};
  for (const [k, v] of acc) {
    v.sort((a, b) => a - b);
    const m = v.length >> 1;
    serie[k] = {
      m: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4),
      med: +(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2).toFixed(3),
      min: v[0],
      max: v[v.length - 1],
      n: v.length
    };
  }

  return { estrazione: dati.estrazione, provincia: dati.provincia, serie };
}

export const isoOggi = () => new Date().toISOString().slice(0, 10);
