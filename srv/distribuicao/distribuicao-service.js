const buscarEndereco = require('../utils/buscarEndereco');
const buscarCoordenadas = require('../utils/buscarCoordenadas');
const calcularRota = require('../utils/calcularRotasORS');
const cds = require('@sap/cds');

module.exports = async function (srv) {
  const { Entrega, Veiculo } = srv.entities;

  /** Action: realizarEntrega */
  srv.on("realizarEntrega", async req => {
    const { pedidoID, cepDestino, numero} = req.data;
  
    try {
      const endereco      = await buscarEndereco(cepDestino);
      const enderecoComNumero =
    `${endereco.rua} ${numero}, ${endereco.cidade}, ${endereco.estado}, ${cepDestino}`;
      const destinoCoords = await buscarCoordenadas(enderecoComNumero);
      const origemCoords  = await buscarCoordenadas("Curitiba, PR");
  
      // ⬇️  DESTRUCTURING CORRETO
      const { distanceKm, geometry } = await calcularRota(origemCoords, destinoCoords);

      console.log("distanciakm", distanceKm)
  
      const transportadora =
        endereco.cidade.toLowerCase() === "curitiba" ? "CuritibaExpress" : "JADLOG";
  
      const veiculo = await SELECT.one.from(Veiculo).where({ emUso: false });
      if (!veiculo) return { success: false, message: "Nenhum veículo disponível" };
  
      const novaEntrega = {
        pedidoID,
        clienteNome      : "Cliente Simulado",
        cepDestino,
        cidadeDestino    : endereco.cidade,
        estadoDestino    : endereco.estado,
        enderecoCompleto : endereco.enderecoCompleto,
        distanciaKm      : distanceKm,   // ✅
        geometry,                        // opcional
        transportadora,
        rastreio         : `R${Math.floor(Math.random() * 1_000_000)}`,
        statusEntrega    : "Criada",
        dataEnvio        : new Date(),
        veiculo_ID       : veiculo.ID
      };
  
      await INSERT.into(Entrega).entries(novaEntrega);
      await UPDATE(Veiculo).set({ emUso: true, status: "EmRota" })
                           .where({ ID: veiculo.ID });
  
      return {
        success  : true,
        message  : `Entrega criada com ${transportadora}`,
        geometry                               // ✅ devolve pro UI5
      };
  
    } catch (e) {
      console.error("Erro na entrega:", e.message);
      return { success: false, message: e.message };
    }
  });
};