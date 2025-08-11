// utils/calcularRota.js
const axios = require("axios");

const ORS_KEY     = process.env.ORS_API_KEY;
const MAPBOX_KEY  = process.env.MAPBOX_TOKEN;
const ORS_TIMEOUT = 30_000;

async function rotaORS(start, end, { roundTrip = false } = {}) {
  const coords = roundTrip
    ? [[start.lon, start.lat], [end.lon, end.lat], [start.lon, start.lat]]
    : [[start.lon, start.lat], [end.lon, end.lat]];

  const url  = "https://api.openrouteservice.org/v2/directions/driving-car";
  const body = {
    coordinates: coords,
    radiuses: new Array(coords.length).fill(300),
    instructions: true
  };

  const { data } = await axios.post(url, body, {
    headers: { Authorization: ORS_KEY, "Content-Type": "application/json" },
    timeout: ORS_TIMEOUT
  });

  const route = data.routes?.[0];
  if (!route) throw new Error("ORS não retornou rota");

  return {
    distanceKm: Math.round(route.summary.distance / 1000),
    geometry  : route.geometry, // polyline
    // une os steps de todos os segmentos (ida e volta)
    steps     : (route.segments || []).flatMap(seg => seg.steps || [])
  };
}

async function rotaMapbox(start, end, { roundTrip = false } = {}) {
  const parts = roundTrip
    ? [`${start.lon},${start.lat}`, `${end.lon},${end.lat}`, `${start.lon},${start.lat}`]
    : [`${start.lon},${start.lat}`, `${end.lon},${end.lat}`];

  // steps=true melhora instruções, mas vamos gerar way_points “fake” para garantir compatibilidade
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${parts.join(";")}` +
              `?geometries=polyline&overview=full&steps=true&access_token=${MAPBOX_KEY}`;

  const { data } = await axios.get(url, { timeout: 20_000 });
  const route = data.routes?.[0];
  if (!route) throw new Error("Mapbox não retornou rota");

  // ⚠️ Mapbox não tem 'way_points' como o ORS.
  // Para manter a simulação compatível, geramos steps “lineares”
  const pts = polyline.decode(route.geometry); // [[lat,lon],...]
  const stepsCompat = [];
  for (let i = 0; i < pts.length - 1; i++) {
    stepsCompat.push({
      instruction: route.legs?.[0]?.steps?.[i]?.maneuver?.instruction || "", // opcional
      way_points: [i, i + 1]
    });
  }

  return {
    distanceKm: Math.round(route.distance / 1000),
    geometry  : route.geometry,
    steps     : stepsCompat
  };
}

module.exports = async function calcularRota(start, end, { roundTrip = false } = {}) {
  try {
    return await rotaORS(start, end, { roundTrip });     // ① tenta ORS
  } catch (err) {
    console.warn("⚠️  ORS falhou:", err.message, "– tentando Mapbox …");
    return await rotaMapbox(start, end, { roundTrip });  // ② fallback Mapbox
  }
};
