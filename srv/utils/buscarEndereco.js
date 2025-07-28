const axios = require('axios');

module.exports = async function buscarEndereco(cep) {
  const url = `https://viacep.com.br/ws/${cep}/json/`;
  const response = await axios.get(url);
  const data = response.data;

  if (data.erro) throw new Error('CEP inválido');

  console.log("enderecoCEP")
  console.log(data)

  return {
    rua: data.logradouro,
    cidade: data.localidade,
    estado: data.uf,
    enderecoCompleto: `${data.logradouro}, ${data.localidade} - ${data.uf}`
  };
};
