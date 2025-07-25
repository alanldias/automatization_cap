const axios = require('axios');

module.exports = async function buscarCoordenadas(endereco) {
  const base = "https://nominatim.openstreetmap.org/search";
  const query1 = encodeURIComponent(endereco) + "&format=json&limit=1";
  const url1 = `${base}?q=${query1}`;

  console.log("🔍 Buscando coordenadas para:", endereco);
  let { data } = await axios.get(url1, {
    headers: { "User-Agent": "DistribuicaoAppCAP/1.0 (thiago@exemplo.com)" }
  });

  // 👉 se não achou com número, tenta só rua + cidade + UF
  if (!data.length) {
    const semNumero = endereco.replace(/\s+\d+[, ]?/, " ");          // remove nº
    const query2 = encodeURIComponent(semNumero) + "&format=json&limit=1";
    const url2 = `${base}?q=${query2}`;
    console.log("   ⚠️ Não achou, tentando sem número:", semNumero);
    ({ data } = await axios.get(url2, { headers: { "User-Agent": "DistribuicaoAppCAP/1.0" } }));
  }

  if (!data.length) throw new Error("Coordenadas não encontradas");

  console.log("📍 Coordenadas:", data[0]);
  return { lat: +data[0].lat, lon: +data[0].lon };
};

