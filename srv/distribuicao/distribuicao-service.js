const buscarEndereco   = require('./utils/buscarEndereco');
const buscarCoords     = require('./utils/buscarCoordenadas');
const calcularRota     = require('./utils/calcularRotasORS');
const cds              = require('@sap/cds');

module.exports = async function (srv) {
  const { Entrega, Veiculo } = srv.entities;

  const PERIOD = h =>      // 08–11 → Manha, 12–17 → Tarde, resto → Noite
  (h >=  8 && h < 12) ? 'Manha'  :
  (h >= 12 && h < 18) ? 'Tarde'  : 'Noite';

  // ---------- ACTION criar -----------
  srv.on('realizarEntrega', async req => {
    const { pedidoID, cepDestino, numero } = req.data;
    try {
      /* 1. Endereço + coords */
      const endereco  = await buscarEndereco(cepDestino);
      const destino   = await buscarCoords(`${endereco.rua} ${numero}, ${endereco.cidade}, ${endereco.estado}, ${cepDestino}`);
      const origem    = await buscarCoords('Curitiba, PR');

      /* 2. Rota completa */
      const { distanceKm, geometry, steps } = await calcularRota(origem, destino);

      /* 3. Reserva de veículo */
      const veiculo = await SELECT.one.from(Veiculo).where({ emUso: false });
      if (!veiculo) return { success:false, message:'Nenhum veículo disponível' };

      /* 4. Persiste entrega – rota incluida! */
      await INSERT.into(Entrega).entries({
        pedidoID,
        clienteNome      : 'Cliente Simulado',
        cepDestino,
        cidadeDestino    : endereco.cidade,
        estadoDestino    : endereco.estado,
        enderecoCompleto : endereco.enderecoCompleto,
        distanciaKm      : distanceKm,
        rotaGeometry     : geometry,
        rotaSteps    : JSON.stringify(steps),          // ← agora mapeado no CDS
        transportadora   : endereco.cidade.toLowerCase() === 'curitiba' ? 'CuritibaExpress' : 'JADLOG',
        rastreio         : `R${Math.trunc(Math.random()*1_000_000)}`,
        statusEntrega    : 'Criada',
        dataEnvio        : new Date(),
        veiculo_ID       : veiculo.ID
      });

      await UPDATE(Veiculo).set({ emUso:true, status:'EmRota' }).where({ ID: veiculo.ID });

      return { success:true, message:'Entrega criada', geometry, steps };

    } catch (err) {
      console.error(err);
      return { success:false, message: err.message };
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
