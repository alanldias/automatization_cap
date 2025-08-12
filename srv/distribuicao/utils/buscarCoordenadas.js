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

/* --- Helpers gerais ----------------------------------------------------- */
function isCoordInBrazil(lat, lon) {
  if (lat == null || lon == null) return false;
  const LAT_MIN = -35, LAT_MAX = 6;
  const LON_MIN = -75, LON_MAX = -32;
  return lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;
}

const CITY_HINT_CACHE = new Map();

function haversineKm(a, b) {
  const toRad = x => x * Math.PI / 180;
  const [lat1, lon1] = a, [lat2, lon2] = b;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s1 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1));
}

async function getCityHint(want) {
  const key = `${normalize(want.city)}|${normalize(want.state)}`;
  if (CITY_HINT_CACHE.has(key)) return CITY_HINT_CACHE.get(key);
  if (!want.city || !want.state) return null;

  try {
    const { data } = await nominatim.get('/search', {
      params: {
        format: 'jsonv2',
        limit: 1,
        countrycodes: 'br',
        city: want.city,
        state: want.state
      }
    });
    const r = data?.[0];
    if (r && isCoordInBrazil(+r.lat, +r.lon)) {
      const hint = { lat: +r.lat, lon: +r.lon };
      CITY_HINT_CACHE.set(key, hint);
      return hint;
    }
  } catch (_) { }
  return null;
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

function normalizeCep(raw = '') {
  const dig = String(raw).replace(/\D/g, '');
  if (dig.length !== 8) return '';
  return `${dig.slice(0, 5)}-${dig.slice(5)}`;
}

function cleanStreet(s) {
  if (!s) return '';
  return String(s)
    .replace(/\bS\/?N\b/gi, '')           // remove S/N
    .replace(/,\s*(S\/?N)\b/gi, '')       // ", S/N"
    .replace(/até\s+\d+\/\d+/i, '')       // remove "até 689/690"
    .replace(/[|;]+/g, ' ')               // separadores estranhos
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*,+|,+\s*$/g, '')        // vírgulas soltas no início/fim
    .trim();
}

function cleanPart(s) {
  return String(s || '')
    .replace(/[|;]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*,+|,+\s*$/g, '')
    .trim();
}

function isBadQuery(q) {
  if (!q) return true;
  const qTrim = q.trim();
  if (qTrim.length < 3) return true;
  // só vírgulas/espacos?
  if (!/[a-zA-Z0-9]/.test(qTrim)) return true;
  return false;
}

/** Monta candidatos de consulta (em ordem de confiança) */
function buildQueryCandidates({ street, number, suburb, city, state, cep }) {
  const country = 'Brasil';
  const hasNum = !!number && /\d+/.test(number);
  const ruaNum = street ? `${street}${hasNum ? ' ' + number : ''}` : '';

  // Monta combinações do mais específico para o mais genérico
  const base = [
    [ruaNum, suburb, city, state, country, cep],
    [ruaNum, city, state, country, cep],
    [ruaNum, city, state, country],
    [street, suburb, city, state, country, cep],
    [street, city, state, country, cep],
    [street, city, state, country],
    [suburb, city, state, country, cep],
    [city, state, country, cep],
    [city, state, country]
  ];

  // Limpa, remove vazios e vírgulas duplas
  const uniq = new Set();
  const list = [];
  for (const arr of base) {
    const q = arr.filter(Boolean).map(cleanPart).join(', ').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ', ');
    if (!isBadQuery(q) && !uniq.has(q)) {
      uniq.add(q);
      list.push(q);
    }
  }
  return list;
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

  // Bairro
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

  // Rua/logradouro (text)
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
  const place = getCtx('place');     // city
  const region = getCtx('region');    // state/UF
  const neigh = getCtx('neighborhood') || getCtx('district') || '';

  if (want.postalcode && postcode && normalize(postcode) === normalize(want.postalcode)) score += 25;
  if (want.city && place && normalize(place) === normalize(want.city)) score += 15;
  if (want.state && region && normalize(region) === normalize(want.state)) score += 10;
  if (want.suburb && neigh && normalize(neigh) === normalize(want.suburb)) score += 15;

  if (typeof feature.relevance === 'number') score += Math.round(feature.relevance * 10);

  // Penaliza genéricos
  score -= typePenaltyMapbox(feature);

  return score;
}

/* --- Mapbox: tenta vários candidatos e ranqueia ------------------------ */
async function geocodeMapboxRankedOne(q, want) {
  if (!MAPBOX_KEY) return null;

  // tenta obter um “alvo” pra proximidade (centro da cidade)
  const cityHint = await getCityHint(want);
  const proximity = cityHint ? `${cityHint.lon},${cityHint.lat}` : undefined;

  const base = {
    access_token: MAPBOX_KEY,
    limit: 5,
    country: 'BR',
    language: 'pt',
    autocomplete: false,
    types: 'address,street,poi,neighborhood,locality,place,postcode',
    ...(proximity ? { proximity } : {})
  };

  const acceptTop = (top) => {
    const ctx = top.f.context || [];
    const getCtx = k => (ctx.find(c => (c.id || '').startsWith(k + '.')) || {}).text || '';
    const postcode = getCtx('postcode');
    const place = getCtx('place');   // cidade
    const region = getCtx('region');  // UF

    const [lon, lat] = top.f.center;
    const hasCEP = want.postalcode && postcode && normalize(postcode) === normalize(want.postalcode);
    const hasCity = want.city && place && normalize(place) === normalize(want.city);
    const hasUF = want.state && region && normalize(region) === normalize(want.state);
    const near = cityHint ? haversineKm([lat, lon], [cityHint.lat, cityHint.lon]) <= 30 : false;

    return hasCEP || (hasCity && hasUF) || near;
  };

  const tryCall = async (params, label) => {
    const { data } = await mapbox.get(`/mapbox.places/${encodeURIComponent(q)}.json`, { params });
    const feats = Array.isArray(data.features) ? data.features : [];
    if (!feats.length) return null;

    const ranked = feats.map(f => ({ f, s: scoreMapbox(f, want) })).sort((a, b) => b.s - a.s);
    const top = ranked[0];
    if (top && top.s >= SCORE_MIN && acceptTop(top)) {
      const [lon, lat] = top.f.center;
      LOG.info(`📍 mapbox OK (${label}) score=${top.s} → ${lat},${lon}`);
      return { lat, lon, src: 'mapbox' };
    }
    return null;
  };

  try {
    const hit1 = await tryCall(base, 'base');
    if (hit1) return hit1;
  } catch (err1) {
    if (err1?.response?.status !== 422) {
      LOG.warn('❌ Mapbox (base):', err1?.response?.data || err1.message);
      return null;
    }
    LOG.warn('⚠️  Mapbox 422 (base). Retentando sem types...');
    try {
      const { types, ...noTypes } = base;
      const hit2 = await tryCall(noTypes, 'noTypes');
      if (hit2) return hit2;
    } catch (err2) {
      if (err2?.response?.status !== 422) {
        LOG.warn('❌ Mapbox (noTypes):', err2?.response?.data || err2.message);
        return null;
      }
      LOG.warn('⚠️  Mapbox 422 (noTypes). Retentando sem autocomplete...');
      try {
        const { autocomplete, types, ...noAuto } = base;
        const hit3 = await tryCall(noAuto, 'noTypes_noAuto');
        if (hit3) return hit3;
      } catch (err3) {
        LOG.warn('❌ Mapbox (noTypes_noAuto):', err3?.response?.data || err3.message);
      }
    }
  }

  return null;
}


// --- Mantém a estratégia de tentar vários candidatos de consulta
async function geocodeMapboxTryMany(candidates, want) {
  for (const q of candidates) {
    if (!q || !/[a-zA-Z0-9]/.test(q)) continue; // evita lixo
    const hit = await geocodeMapboxRankedOne(q, want);
    if (hit) return hit;
  }
  return null;
}

/* --- Nominatim (structured) com ranking -------------------------------- */
async function nominatimStructured(params, label, want) {
  try {
    const { data } = await nominatim.get('/search', {
      params: {
        format: 'jsonv2',
        limit: 5,
        addressdetails: 1,
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
  // Preferir dados estruturados (rua/cidade/UF/CEP/bairro/número)
  const street = cleanStreet(opts.street || '');
  const number = cleanPart(opts.number || '');
  const city = cleanPart(opts.city || '');
  const state = cleanPart(opts.state || '');
  const suburb = cleanPart(opts.suburb || '');
  const cep = normalizeCep(opts.postalcode || '');

  const want = { street, city, state, suburb, postalcode: cep };

  const labelHumano =
    endereco ||
    [street, number, suburb, city, state, cep].filter(Boolean).join(', ');

  LOG.info('🔍 Geocoding →', labelHumano);

  // Candidatos sanitizados para consultas (evita 422 e melhora precisão)
  const candidates = buildQueryCandidates({ street, number, suburb, city, state, cep });

  /* 1) Mapbox (tenta vários candidatos) -------------------------------- */
  let hit = await geocodeMapboxTryMany(candidates, want);
  if (hit) return hit;

  /* 2) Nominatim structured (combinações fortes) ----------------------- */
  // a) rua+cidade+estado+cep
  if (street || city || state || cep) {
    hit = await nominatimStructured(
      { street: street ? `${street} ${number}`.trim() : '', city, state, postalcode: cep, country: 'Brasil' },
      'street+city+state+cep',
      want
    );
    if (hit) return hit;

    // b) rua+cidade+estado
    hit = await nominatimStructured(
      { street: street ? `${street} ${number}`.trim() : '', city, state, country: 'Brasil' },
      'street+city+state',
      want
    );
    if (hit) return hit;

    // c) cep+cidade+estado
    if (cep) {
      hit = await nominatimStructured(
        { postalcode: cep, city, state, country: 'Brasil' },
        'cep+city+state',
        want
      );
      if (hit) return hit;
    }
  }

  /* 3) Freetext (com bairro) tentando Mapbox -> Nominatim --------------- */
  for (const q of candidates) {
    hit = await geocodeMapboxRankedOne(q, want);
    if (hit) return hit;

    hit = await nominatimFreeText(q, q, want);
    if (hit) return hit;
  }

  /* 4) Último recurso: texto bruto recebido ----------------------------- */
  if (endereco && !isBadQuery(endereco)) {
    const q = /brasil/i.test(endereco) ? endereco : `${endereco}, Brasil`;
    hit = await geocodeMapboxRankedOne(q, want);
    if (hit) return hit;

    hit = await nominatimFreeText(q, endereco, want);
    if (hit) return hit;
  }

  throw new Error('Coordenadas não encontradas');
};
