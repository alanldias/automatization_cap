// utils/buscarCoordenadas.js
const cds = require('@sap/cds');
const LOG = cds.log('utils:buscarCoordenadas');
const axios = require('axios');
require('dotenv').config();

/* --- Config ------------------------------------------------------------- */
const MAPBOX_KEY = process.env.MAPBOX_TOKEN || process.env.MAPCORDS_TOKEN;
const UA = 'DistribuicaoAppCAP/1.0 (thiago@exemplo.com)';
const TIMEOUT = 10_000;

// Envelope aproximado do Brasil (viewbox: left,top,right,bottom)
const BR_VIEWBOX = '-75,6,-32,-35';

// score mínimo pra aceitar um candidato (ajuste se necessário)
const SCORE_MIN = 25;

/* --- Axios -------------------------------------------------------------- */
const mapbox = axios.create({ baseURL: 'https://api.mapbox.com/geocoding/v5' });
const nominatim = axios.create({
  baseURL: 'https://nominatim.openstreetmap.org',
  headers: { 'User-Agent': UA },
  timeout: TIMEOUT
});

/* --- Helpers ------------------------------------------------------------ */
function isCoordInBrazil(lat, lon) {
  if (lat == null || lon == null) return false;
  const LAT_MIN = -35, LAT_MAX = 6;
  const LON_MIN = -75, LON_MAX = -32;
  return lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;
}

function cleanStreet(s) {
  if (!s) return '';
  return String(s)
    .replace(/\bS\/?N\b/gi, '')          // remove S/N
    .replace(/até\s+\d+\/\d+/i, '')      // remove "até 689/690"
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*$/, '')
    .trim();
}

function normalize(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}
function tokenSet(s = '') {
  return new Set(normalize(s).split(/\s+/).filter(Boolean));
}

/* ---------- Scoring: Nominatim ---------------------------------------- */
function typePenaltyNominatim(r) {
  const cls = r.class;           // boundary/place/highway/…
  const typ = r.type;            // administrative/state/city/residential/…
  const addrt = r.addresstype;   // road/house/state/postcode/…
  if (addrt === 'postcode' || typ === 'postcode') return 100;      // CEP centróide
  if (addrt === 'state' || typ === 'state') return 90;             // estado
  if (cls === 'boundary' && typ === 'administrative') return 80;   // adm genérico
  if (cls === 'place' && (typ === 'city' || typ === 'town' || typ === 'village')) return 70; // cidade/bairro genérico
  return 0;
}

function scoreNominatim(r, want) {
  const lat = Number(r.lat), lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return -1;
  if (!isCoordInBrazil(lat, lon)) return -1;

  const a = r.address || {};
  let score = 0;

  // Rua / logradouro
  const road = a.road || a.pedestrian || a.footway || a.path || a.square || a.cycleway || '';
  const wantRoad = normalize(want.street || '');
  if (wantRoad) {
    const inter = [...tokenSet(road)].filter(t => tokenSet(wantRoad).has(t));
    score += inter.length * 15;
    if (normalize(r.display_name || '').includes(wantRoad)) score += 10;
  }

  // Bairro (suburb / neighbourhood / quarter)
  const suburb = a.suburb || a.neighbourhood || a.quarter || '';
  if (want.suburb && normalize(suburb) === normalize(want.suburb)) score += 20;

  // CEP
  if (want.postalcode && a.postcode && normalize(a.postcode) === normalize(want.postalcode)) score += 25;

  // Cidade / UF
  if (want.city && (a.city || a.town || a.village)) {
    const gotCity = a.city || a.town || a.village;
    if (normalize(gotCity) === normalize(want.city)) score += 15;
  }
  if (want.state && (a.state || a.region) && normalize(a.state || a.region) === normalize(want.state)) score += 10;

  // Preferir classes viárias/endereço
  if (r.class === 'highway') score += 20;
  if (['road', 'house', 'residential', 'pedestrian', 'square'].includes(r.addresstype)) score += 10;

  // Penalizar genéricos
  score -= typePenaltyNominatim(r);

  return score;
}

/* ---------- Scoring: Mapbox ------------------------------------------- */
function typePenaltyMapbox(feature) {
  // place_type: ["address"], ["street"], ["neighborhood"], ["locality"], ["place"], ["postcode"], …
  const t = (feature.place_type || [])[0] || '';
  if (t === 'postcode') return 100;
  if (t === 'place' || t === 'locality') return 70;  // cidade/município
  if (t === 'neighborhood') return 50;
  return 0;
}

function scoreMapbox(feature, want) {
  if (!feature || !Array.isArray(feature.center)) return -1;
  const [lon, lat] = feature.center;
  if (!isCoordInBrazil(lat, lon)) return -1;

  let score = 0;

  const t = (feature.place_type || [])[0] || '';
  if (t === 'address') score += 40;
  else if (t === 'street') score += 25;
  else if (t === 'poi') score += 15;
  else if (t === 'neighborhood') score += 10;

  // Rua/logradouro (text) – interseção de tokens
  const wantRoad = normalize(want.street || '');
  if (wantRoad) {
    const inter = [...tokenSet(feature.text || '')].filter(x => tokenSet(wantRoad).has(x));
    score += inter.length * 15;
    if (normalize(feature.place_name || '').includes(wantRoad)) score += 10;
  }

  // CEP, Cidade, UF no context
  const ctx = feature.context || [];
  const getCtx = k => (ctx.find(c => (c.id || '').startsWith(k + '.')) || {}).text || '';

  const postcode = getCtx('postcode');
  const place    = getCtx('place');     // city
  const region   = getCtx('region');    // state/UF
  const neigh    = getCtx('neighborhood') || getCtx('district') || '';

  if (want.postalcode && postcode && normalize(postcode) === normalize(want.postalcode)) score += 25;
  if (want.city && place && normalize(place) === normalize(want.city)) score += 15;
  if (want.state && region && normalize(region) === normalize(want.state)) score += 10;
  if (want.suburb && neigh && normalize(neigh) === normalize(want.suburb)) score += 15;

  // relevância nativa da Mapbox
  if (typeof feature.relevance === 'number') score += Math.round(feature.relevance * 10);

  // Penaliza genéricos
  score -= typePenaltyMapbox(feature);

  return score;
}

/* --- Mapbox: busca com múltiplos candidatos e ranking ------------------ */
async function geocodeMapboxRanked(q, want) {
  if (!MAPBOX_KEY) return null;
  try {
    const { data } = await mapbox.get(`/mapbox.places/${encodeURIComponent(q)}.json`, {
      params: {
        access_token: MAPBOX_KEY,
        limit: 5,
        country: 'BR',
        language: 'pt',
        autocomplete: false,
        // prioriza endereços/ruas; deixa place/postcode no fim
        types: 'address,street,poi,neighborhood,locality,place,postcode',
        // bbox do Brasil (lon_min, lat_min, lon_max, lat_max) — diferente do Nominatim
        bbox: '-73.99,-33.75,-34.79,5.27'
      }
    });

    const feats = Array.isArray(data.features) ? data.features : [];
    if (!feats.length) return null;

    const ranked = feats
      .map(f => ({ f, s: scoreMapbox(f, want) }))
      .sort((a, b) => b.s - a.s);

    const top = ranked[0];
    if (top && top.s >= SCORE_MIN) {
      const [lon, lat] = top.f.center;
      LOG.info(`📍 mapbox OK score=${top.s} (${(top.f.place_type||[]).join(',')}) → ${lat},${lon}`);
      return { lat, lon, src: 'mapbox' };
    }

    return null;
  } catch (err) {
    LOG.warn('❌ Mapbox:', err.message);
    return null;
  }
}

/* --- Nominatim (structured) com ranking -------------------------------- */
async function nominatimStructured(params, label, want) {
  try {
    const { data } = await nominatim.get('/search', {
      params: {
        format: 'jsonv2',
        limit: 5,
        addressdetails: 1,   // precisamos do address pra ranquear
        countrycodes: 'br',
        viewbox: BR_VIEWBOX,
        bounded: 1,
        ...params
      }
    });

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return null;

    const ranked = rows
      .map(r => ({ r, s: scoreNominatim(r, want) }))
      .sort((a, b) => b.s - a.s);

    const top = ranked[0];
    if (top && top.s >= SCORE_MIN) {
      LOG.info(`📍 nominatim structured OK (${label}) score=${top.s}`);
      return { lat: +top.r.lat, lon: +top.r.lon, src: 'nominatim' };
    }
    return null;
  } catch (e) {
    LOG.warn('❌ Nominatim structured:', e.message);
    return null;
  }
}

/* --- Nominatim (freetext) com ranking ---------------------------------- */
async function nominatimFreeText(q, label, want) {
  try {
    const { data } = await nominatim.get('/search', {
      params: {
        q,
        format: 'jsonv2',
        limit: 5,
        addressdetails: 1,
        countrycodes: 'br',
        viewbox: BR_VIEWBOX,
        bounded: 1
      }
    });

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return null;

    const ranked = rows
      .map(r => ({ r, s: scoreNominatim(r, want) }))
      .sort((a, b) => b.s - a.s);

    const top = ranked[0];
    if (top && top.s >= SCORE_MIN) {
      LOG.info(`📍 nominatim OK (“${label}”) score=${top.s}`);
      return { lat: +top.r.lat, lon: +top.r.lon, src: 'nominatim' };
    }
    return null;
  } catch (e) {
    LOG.warn('❌ Nominatim freetext:', e.message);
    return null;
  }
}

/* --- Função principal --------------------------------------------------- */
module.exports = async function buscarCoordenadas(endereco, opts = {}) {
  // Preferir dados estruturados (rua/cidade/UF/CEP/bairro)
  const street = cleanStreet(opts.street || '');
  const city   = opts.city   || '';
  const state  = opts.state  || '';
  const suburb = opts.suburb || '';
  const cep    = (opts.postalcode || '')
    .replace(/\D/g, '')
    .replace(/^(\d{5})(\d{3})$/, '$1-$2');

  const country = 'Brasil';
  const want = { street, city, state, suburb, postalcode: cep };

  const labelHumano =
    endereco ||
    [street, suburb, city, state, cep].filter(Boolean).join(', ');

  LOG.info('🔍 Geocoding →', labelHumano);

  /* 1) Mapbox (string completa) ---------------------------------------- */
  const qFull = endereco || [street, suburb, city, state, country, cep]
    .filter(Boolean).join(', ');
  let hit = await geocodeMapboxRanked(qFull, want);
  if (hit) return hit;

  /* 2) Nominatim structured (combinações fortes) ----------------------- */
  // a) rua+cidade+estado+cep
  hit = await nominatimStructured(
    { street, city, state, postalcode: cep, country },
    'street+city+state+cep', want
  );
  if (hit) return hit;

  // b) rua+cidade+estado
  hit = await nominatimStructured(
    { street, city, state, country },
    'street+city+state', want
  );
  if (hit) return hit;

  // c) cep+cidade+estado (quando rua falha)
  if (cep) {
    hit = await nominatimStructured(
      { postalcode: cep, city, state, country },
      'cep+city+state', want
    );
    if (hit) return hit;
  }

  /* 3) Freetext (com bairro) tentando Mapbox -> Nominatim por tentativa */
  const tries = [
    [street, suburb, city, state, country, cep].filter(Boolean).join(', '),
    [street, city, state, country].filter(Boolean).join(', '),
    [suburb, city, state, country, cep].filter(Boolean).join(', '),
    [city, state, country].filter(Boolean).join(', ')
  ].filter(Boolean);

  for (const q of tries) {
    hit = await geocodeMapboxRanked(q, want);
    if (hit) return hit;

    hit = await nominatimFreeText(q, q, want);
    if (hit) return hit;
  }

  /* 4) Último recurso: texto bruto recebido */
  if (endereco) {
    const q = /brasil/i.test(endereco) ? endereco : `${endereco}, Brasil`;
    hit = await geocodeMapboxRanked(q, want);
    if (hit) return hit;

    hit = await nominatimFreeText(q, endereco, want);
    if (hit) return hit;
  }

  throw new Error('Coordenadas não encontradas');
};
