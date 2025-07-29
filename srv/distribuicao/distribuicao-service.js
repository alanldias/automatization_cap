const buscarEndereco   = require('./utils/buscarEndereco');
const buscarCoords     = require('./utils/buscarCoordenadas');
const calcularRota     = require('./utils/calcularRotasORS');
const selecionarVeiculoEcd = require('./utils/selecionarVeiculo');
const cds              = require('@sap/cds');

module.exports = async function (srv) {
  const { Entrega, Veiculo } = srv.entities;

  const PERIOD = h =>      // 08–11 → Manha, 12–17 → Tarde, resto → Noite
  (h >=  8 && h < 12) ? 'Manha'  :
  (h >= 12 && h < 18) ? 'Tarde'  : 'Noite';

  // ---------- ACTION criar -----------
  srv.on("realizarEntrega", async req => {
    const { pedidoID, cepDestino, numero } = req.data;
  
    try {
      // 1. Busca endereço e coordenadas de destino
      const endereco = await buscarEndereco(cepDestino);
      const destino = await buscarCoords(
        `${endereco.rua} ${numero}, ${endereco.cidade}, ${endereco.estado}, ${cepDestino}`
      );      
      // 2. Seleciona veículo e CD disponível para o estado
      const selecao = await selecionarVeiculoEcd(endereco.estado);
      if (!selecao)
        return { success: false, message: `Nenhum veículo disponível em ${endereco.estado}` };
  
      const { veiculo, cd } = selecao;
  
      // 3. Busca coordenadas de origem
      const origemCoords = cd.lat
        ? { lat: cd.lat, lon: cd.lon }
        : await buscarCoords(`${cd.endereco}, ${cd.cidade}, ${cd.estado}`);

        console.log(`📦 Origem (${cd.nome}) →`, origemCoords);

  
      // 4. Calcula rota
      const { distanceKm, geometry, steps } = await calcularRota(origemCoords, destino);

      const codigoRastreio = `R${Math.trunc(Math.random() * 1_000_000)}`;
  
      // 5. Cria entrega
      await INSERT.into(Entrega).entries({
        pedidoID,
        clienteNome      : "Cliente Simulado",
        cepDestino,
        cidadeDestino    : endereco.cidade,
        estadoDestino    : endereco.estado,
        enderecoCompleto : endereco.enderecoCompleto,
        distanciaKm      : distanceKm,
        rotaGeometry     : geometry,
        rotaSteps        : JSON.stringify(steps),
        transportadora   : cd.nome,
        rastreio: codigoRastreio,
        statusEntrega    : "Criada",
        dataEnvio        : new Date(),
        veiculo_ID       : veiculo.ID,
        centroDist_ID    : cd.ID
      });
  
      // 6. Marca veículo como em uso
      await UPDATE(Veiculo).set({ emUso: true, status: "EmRota" }).where({ ID: veiculo.ID });
  
      return {
        success : true,
        message : `Entrega criada a partir do CD ${cd.nome}`,
        geometry,
        steps,
        rastreio: codigoRastreio  
      };
  
    } catch (err) {
      console.error(err);
  
      let msg = "Falha ao criar entrega. Tente novamente.";
      if (err.response?.status === 401) msg = "Serviço externo não autorizado.";
      if (err.code === "ECONNREFUSED")  msg = "Serviço externo fora do ar.";
  
      return { success: false, message: msg };
    }
  });

  // ---------- ACTION rastrear -----------
  srv.on('rastrearEntrega', async ({ data:{ codigo }}) => {
    const entrega = await SELECT.one.from(Entrega).where({ rastreio: codigo });
    if (!entrega) return { success:false, message:'Código não encontrado' };
  
    return {
      success        : true,
      message        : 'Dados encontrados',
      geometry       : entrega.rotaGeometry,
      steps          : JSON.parse(entrega.rotaSteps || "[]"),
      statusEntrega  : entrega.statusEntrega,
      horarioEntrega : entrega.horarioEntrega,      //  ←
      distanciaKm    : entrega.distanciaKm
    };
  });

  srv.on('atualizarStatusEntrega', async req => {
    const { codigo, novoStatus } = req.data;
  
    const entrega = await SELECT.one.from(Entrega).where({ rastreio: codigo });
    if (!entrega) return { success:false, message:'Código não encontrado' };
  
    /* Se marcar como Entregue, calcula horário */
    let horarioEntrega = entrega.horarioEntrega;
    if (novoStatus === 'Entregue' && !horarioEntrega) {
      const now = new Date();                       // hora do servidor
      const h   = now.getHours().toString().padStart(2, '0');
      const m   = now.getMinutes().toString().padStart(2, '0');
      horarioEntrega = `${PERIOD(now.getHours())}-${h}:${m}`;
    }
  
    await UPDATE(Entrega).set({
      statusEntrega : novoStatus,
      horarioEntrega
    }).where({ ID: entrega.ID });
  
    return {
      success       : true,
      message       : `Status alterado para ${novoStatus}`,
      horarioEntrega
    };
  });
};
