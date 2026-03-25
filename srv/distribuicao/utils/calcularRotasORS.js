// utils/calcularRota.js
const axios = require("axios");

const ORS_KEY     = process.env.ORS_API_KEY;        // coloque no .env
const MAPBOX_KEY  = process.env.MAPBOX_TOKEN;       // coloque no .env
const ORS_TIMEOUT = 30_000;                         // 30 s

async function rotaORS(start, end) {
  const url  = "https://api.openrouteservice.org/v2/directions/driving-car";
  const body = {
    coordinates: [
      [start.lon, start.lat],
      [end.lon  , end.lat  ]
    ],
    radiuses: [300, 300],
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
    geometry  : route.geometry,
    steps     : route.segments?.[0]?.steps || []
  };
}

async function rotaMapbox(start, end) {
  const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
              `?geometries=polyline&overview=full&access_token=${MAPBOX_KEY}`;

  const { data } = await axios.get(url, { timeout: 20_000 });

  const route = data.routes?.[0];
  if (!route) throw new Error("Mapbox não retornou rota");

  console.log("data",data)

  return {
    distanceKm: Math.round(route.distance / 1000),
    geometry  : route.geometry,         // polyline
    steps     : route.legs?.[0]?.steps || []
  };
}

module.exports = async function calcularRota(start, end) {
  try {
    return await rotaORS(start, end);              // ① tenta ORS
  } catch (err) {
    console.warn("⚠️  ORS falhou:", err.message, "– tentando Mapbox …");
    return await rotaMapbox(start, end);           // ② fallback Mapbox
  }
};
