const axios = require("axios");
require("dotenv").config();

/* --- Config ------------------------------------------------------------- */
const MAPBOX_KEY = process.env.MAPCORDS_TOKEN;          
const UA         = "DistribuicaoAppCAP/1.0 (thiago@exemplo.com)";
const TIMEOUT    = 10_000;

/* --- Axios instances ---------------------------------------------------- */
const mapbox = axios.create({ baseURL: "https://api.mapbox.com/geocoding/v5" });
const nominatim = axios.create({
  baseURL: "https://nominatim.openstreetmap.org",
  headers: { "User-Agent": UA },
  timeout : TIMEOUT
});

/* --- Mapbox ------------------------------------------------------------- */
async function geocodeMapbox(q) {
  if (!MAPBOX_KEY) return null;                         // sem token → pula
  try {
    const { data } = await mapbox.get(`/mapbox.places/${encodeURIComponent(q)}.json`, {
      params: { access_token: MAPBOX_KEY, limit: 1 }
    });
    const f = data.features?.[0];
    return f && { lat: f.center[1], lon: f.center[0], src: "mapbox" };
  } catch (e) {
    console.warn("❌ Mapbox:", e.message);
    return null;
  }
}

/* --- Nominatim helpers -------------------------------------------------- */
const VARIACOES = [
  s => s,                                               // 1) completo
  s => s.replace(/\b[Kk][mM]\s*\d+\b/, ""),             // 2) tira “Km nnn”
  s => s.replace(/^\s*\d+\s+/, ""),                     // 3) tira nº inicial
  s => s.replace(/\b\d{5}-?\d{3}\b/, ""),               // 4) tira CEP
  s => {                                               // 5) cidade + UF
    const p = s.split(",");
    return p.length >= 2 ? p.slice(-2).join(",") : s;
  }
];

async function geocodeNominatim(q) {
  for (const transform of VARIACOES) {
    const query = transform(q).replace(/\s{2,}/g, " ").trim();
    if (!query) continue;

    const { data } = await nominatim.get("/search", {
      params: { q: query, format: "json", limit: 1 }
    });
    const r = data?.[0];
    if (r) {
      console.log(`📍 nominatim OK (“${query}”)`);
      return { lat: +r.lat, lon: +r.lon, src: "nominatim" };
    }
  }
  return null;
}

/* --- Função principal --------------------------------------------------- */
module.exports = async function buscarCoordenadas(endereco) {
  console.log("🔍 Geocoding →", endereco);

  // 1️⃣ Mapbox primeiro
  const viaMapbox = await geocodeMapbox(endereco);
  if (viaMapbox) return viaMapbox;

  // 2️⃣ Fallback Nominatim
  const viaNominatim = await geocodeNominatim(endereco);
  if (viaNominatim) return viaNominatim;

  throw new Error("Coordenadas não encontradas");
};
