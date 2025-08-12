// utils/calcularRotaMultipla.js
const cds = require('@sap/cds');
const LOG = cds.log('utils:calcularRotaMultipla');
const axios = require('axios');
const buscarEndereco = require('./buscarEndereco');      // via CEP (viacep)
const buscarCoords   = require('./buscarCoordenadas');   // nosso geocoder ranqueado

const ORS_KEY = process.env.ORS_API_KEY;                // <<< confere nome da env var!

function isCoordInBrazil(lat, lon) {
  if (lat == null || lon == null) return false;
  const LAT_MIN = -35, LAT_MAX = 6;
  const LON_MIN = -75, LON_MAX = -32;
  return lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;
}

/**
 * pedidos: [
 *   { pedidoID, cep, numero, coords?:{lat,lon}, cidade?, estado?, logradouro?, bairro? }
 * ]
 * cdOrigem: { endereco, cidade, estado, cep?, lat?, lon? }
 * opts: { preferirCoords?: boolean }
 */
module.exports = async function calcularRotaMultipla(pedidos, cdOrigem, opts = {}) {
  try {
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      throw new Error('Nenhum pedido informado para rota múltipla.');
    }
    if (!ORS_KEY) {
      throw new Error('Falta ORS_API_KEY no ambiente.');
    }

    const preferirCoords = !!opts.preferirCoords;

    // 1) Origem (usa coords do CD se houver, senão geocoda estruturado)
    let origemLat = cdOrigem?.lat, origemLon = cdOrigem?.lon;
    if (!isCoordInBrazil(origemLat, origemLon)) {
      const hit = await buscarCoords(
        `${cdOrigem.endereco || ''}, ${cdOrigem.cidade}, ${cdOrigem.estado}, Brasil${cdOrigem.cep ? ', ' + cdOrigem.cep : ''}`,
        {
          street     : cdOrigem.endereco || '',
          city       : cdOrigem.cidade,
          state      : cdOrigem.estado,
          postalcode : cdOrigem.cep || ''
        }
      );
      origemLat = hit.lat; origemLon = hit.lon;
    }
    const origem = { lat: origemLat, lon: origemLon };

    // 2) Destinos: NÃO regeocodar se já tem coords válidas
    const jobs = [];                 // p/ ORS optimization
    const pedidosComCoord = [];      // mantemos os dados enriquecidos
    for (let i = 0; i < pedidos.length; i++) {
      const p = pedidos[i];
      let lat = p?.coords?.lat;
      let lon = p?.coords?.lon;

      if (!(preferirCoords && isCoordInBrazil(lat, lon))) {
        // Precisamos geocodar — tenta via CEP estruturando endereço
        // (Se vierem cidade/estado/logradouro/bairro no objeto do pedido,
        // usamos diretamente; senão pegamos do VIACEP pelo CEP)
        let end = null;
        try {
          if (p.logradouro || p.cidade || p.estado || p.bairro) {
            end = {
              logradouro: p.logradouro || '',
              localidade: p.cidade || '',
              uf: p.estado || '',
              bairro: p.bairro || ''
            };
          } else {
            end = await buscarEndereco(p.cep);
          }
        } catch (e) {
          throw new Error(`Endereço não encontrado para pedido ${p.pedidoID} (CEP ${p.cep}).`);
        }

        const street = `${end.logradouro || ''} ${p.numero || ''}`.trim();
        const hit = await buscarCoords(
          `${street}, ${end.localidade}, ${end.uf}, Brasil${p.cep ? ', ' + p.cep : ''}`,
          {
            street,
            city       : end.localidade,
            state      : end.uf,
            postalcode : p.cep || '',
            suburb     : end.bairro || ''
          }
        );
        lat = hit.lat; lon = hit.lon;
      }

      if (!isCoordInBrazil(lat, lon)) {
        throw new Error(`Coordenadas inválidas para pedido ${p.pedidoID}.`);
      }

      // ORS optimization espera [lon,lat]
      jobs.push({ id: i + 1, pedidoID: p.pedidoID, location: [lon, lat], lat, lon });
      pedidosComCoord.push({ ...p, lat, lon });
    }

    // 3) Chama ORS Optimization para obter a sequência ótima
    const optimizationPayload = {
      jobs: jobs.map(j => ({ id: j.id, location: j.location })),
      vehicles: [{
        id: 1,
        profile: 'driving-car',
        start: [origem.lon, origem.lat],
        end  : [origem.lon, origem.lat]   // retorna ao CD (ajuste se não quiser)
      }]
    };

    const optResp = await axios.post(
      'https://api.openrouteservice.org/optimization',
      optimizationPayload,
      { headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json' } }
    );

    const stepsOpt = optResp.data?.routes?.[0]?.steps;
    if (!stepsOpt) throw new Error('Falha ao otimizar rota');

    // 4) Constrói as coordinates na ordem do plano (start -> jobs... -> end)
    const coordinates = stepsOpt.map(s => s.location); // cada "step" já vem [lon,lat]

    // 5) Directions para pegar geometry/steps detalhados
    const dirResp = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car',
      { coordinates, instructions: true },
      { headers: { Authorization: ORS_KEY, 'Content-Type': 'application/json' } }
    );

    const route = dirResp.data?.routes?.[0];
    if (!route) throw new Error('Falha ao calcular rota final');

    // 6) Pedidos na ordem (filtra apenas steps de tipo "job")
    const pedidosOrdenados = stepsOpt
      .filter(s => s.type === 'job')
      .map(s => {
        const job = jobs.find(j => j.id === s.id);
        return {
          pedidoID: job.pedidoID,
          lat: job.lat,
          lon: job.lon
        };
      });

    // destinos p/ front: [lat,lon] na MESMA ordem da rota
    const destinos = pedidosOrdenados.map(p => [p.lat, p.lon]);

    // distância em km (summary.distance em metros)
    const distanceKm = Math.round((route.summary?.distance || 0) / 1000);

    return {
      success: true,
      distanceKm,
      geometry: route.geometry,
      steps: (route.segments?.flatMap(seg => seg.steps) || []),
      pedidosOrdenados,
      destinos
    };
  } catch (err) {
    LOG.error('Erro ao calcular rota múltipla:', err);
    return {
      success: false,
      message: err.message || 'Erro ao calcular rota múltipla. Verifique os dados ou a chave da API.'
    };
  }
};
