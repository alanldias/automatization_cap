// utils/calcularRotaMultipla.js

const axios = require("axios");
const buscarEndereco = require("./buscarEndereco");
const buscarCoords = require("./buscarCoordenadas");

const ORS_KEY = process.env.ORS_API_KEY;

async function calcularRotaMultipla(pedidos, cdOrigem) {
    try {
      // 1. Coordenadas da origem (CD dinâmico)
      const origem = cdOrigem.lat
        ? { lat: cdOrigem.lat, lon: cdOrigem.lon }
        : await buscarCoords(`${cdOrigem.endereco}, ${cdOrigem.cidade}, ${cdOrigem.estado}`)

    // 2. Buscar coordenadas dos pedidos
    const jobs = [];
    for (let i = 0; i < pedidos.length; i++) {
      const { pedidoID, cep, numero } = pedidos[i];
      const endereco = await buscarEndereco(cep);
      const coords = await buscarCoords(`${endereco.rua} ${numero}, ${endereco.cidade}, ${endereco.estado}, ${cep}`);
      jobs.push({ id: i + 1, pedidoID, coords });
    }

    // 3. Enviar para o ORS Optimization
    const optimizationPayload = {
      jobs: jobs.map(j => ({
        id: j.id,
        location: [j.coords.lon, j.coords.lat]
      })),
      vehicles: [{
        id: 1,
        profile: "driving-car",
        start: [origem.lon, origem.lat],
        end: [origem.lon, origem.lat] // ou outro destino final, se quiser
      }]
    };

    const optimizationResponse = await axios.post(
      "https://api.openrouteservice.org/optimization",
      optimizationPayload,
      {
        headers: {
          Authorization: ORS_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const steps = optimizationResponse.data.routes?.[0]?.steps;
    if (!steps) throw new Error("Falha ao otimizar rota");

    // 4. Obter a sequência de coordenadas ordenadas
    const coordinates = steps.map(s => s.location);

    // 5. Calcular a rota real (geometry) com base na ordem otimizada
    const directionsResponse = await axios.post(
      "https://api.openrouteservice.org/v2/directions/driving-car",
      {
        coordinates,
        instructions: true
      },
      {
        headers: {
          Authorization: ORS_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    const route = directionsResponse.data.routes?.[0];
    if (!route) throw new Error("Falha ao calcular rota final");

        const pedidosOrdenados = steps
    .filter(s => s.type === "job")
    .map(s => {
        const job = jobs.find(j => j.id === s.id);
        return {
        pedidoID : job.pedidoID,
        coords   : job.coords           // { lat, lon }
        };
    });

    return {
      success: true,
      geometry: route.geometry,
      steps   : route.segments?.flatMap(seg => seg.steps) || [],
      pedidosOrdenados,
      destinos: pedidosOrdenados.map(p => [p.coords.lat, p.coords.lon])

    };

  } catch (err) {
    console.error("Erro ao calcular rota múltipla:", err);
    return {
      success: false,
      message: "Erro ao calcular rota múltipla. Verifique os dados ou a chave da API."
    };
  }
}

module.exports = calcularRotaMultipla;
