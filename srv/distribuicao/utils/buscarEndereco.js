const axios = require("axios");

module.exports = async function buscarEndereco(cep) {
  try {
    const url = `https://viacep.com.br/ws/${cep}/json/`;
    const response = await axios.get(url);
    const data = response.data;

    if (data.erro) throw new Error("CEP inválido");

    console.log("📦 Endereço encontrado:", data);

    return {
      rua: data.logradouro,
      cidade: data.localidade,
      estado: data.uf,
      enderecoCompleto: `${data.logradouro}, ${data.localidade} - ${data.uf}`
    };
  } catch (err) {
    console.error("❌ Erro ao buscar endereço:", err.message);
    throw err;
  }
};
