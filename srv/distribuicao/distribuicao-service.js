const buscarEndereco = require('./utils/buscarEndereco');
const buscarCoords = require('./utils/buscarCoordenadas');
const calcularRota = require('./utils/calcularRotasORS');
const selecionarVeiculoEcd = require('./utils/selecionarVeiculo');
const cds = require('@sap/cds');

module.exports = async function (srv) {
  const { Entrega, Veiculo } = srv.entities;

  const PERIOD = h => (h >= 8 && h < 12) ? 'Manha' : (h >= 12 && h < 18) ? 'Tarde' : 'Noite';

  // ---------- ACTION criar -----------
  srv.on("realizarEntrega", async req => {
    const { pedidoID, cepDestino, numero } = req.data;
    const tx = cds.tx(req); // 💡 inicia a transação segura

    try {
      const endereco = await buscarEndereco(cepDestino);
      const destino = await buscarCoords(`${endereco.rua} ${numero}, ${endereco.cidade}, ${endereco.estado}, ${cepDestino}`);

      const selecao = await selecionarVeiculoEcd(endereco.estado);
      if (!selecao)
        return { success: false, message: `Nenhum veículo disponível em ${endereco.estado}` };

      const { veiculo, cd } = selecao;

      const origemCoords = cd.lat
        ? { lat: cd.lat, lon: cd.lon }
        : await buscarCoords(`${cd.endereco}, ${cd.cidade}, ${cd.estado}`);

      console.log(`📦 Origem (${cd.nome}) →`, origemCoords);

      const { distanceKm, geometry, steps } = await calcularRota(origemCoords, destino);

      const codigoRastreio = `R${Math.trunc(Math.random() * 1_000_000)}`;

      // 💾 Inserção usando transação
      await tx.run(INSERT.into(Entrega).entries({
        pedidoID,
        clienteNome: "Cliente Simulado",
        cepDestino,
        cidadeDestino: endereco.cidade,
        estadoDestino: endereco.estado,
        enderecoCompleto: endereco.enderecoCompleto,
        distanciaKm: distanceKm,
        rotaGeometry: geometry,
        etapasRota: JSON.stringify(steps),            // ✅ nome atualizado
        transportadora: cd.nome,
        rastreio: codigoRastreio,
        statusEntrega: "CRIADA",                          // ✅ Enum em UPPER_CASE
        dataEnvio: new Date(),
        veiculo_ID: veiculo.ID,
        centroDistribuicao_ID: cd.ID                            // ✅ nome atualizado
      }));

      // 🚗 Atualização usando transação
      await tx.run(UPDATE(Veiculo).set({ emUso: true, status: "EmRota" }).where({ ID: veiculo.ID }));

      return {
        success: true,
        message: `Entrega criada a partir do CD ${cd.nome}`,
        geometry,
        steps,
        rastreio: codigoRastreio
      };

    } catch (err) {
      console.error(err);

      let msg = "Falha ao criar entrega. Tente novamente.";
      if (err.response?.status === 401) msg = "Serviço externo não autorizado.";
      if (err.code === "ECONNREFUSED") msg = "Serviço externo fora do ar.";

      return { success: false, message: msg };
    }
  });

  // ---------- ACTION rastrear -----------
  srv.on('rastrearEntrega', async ({ data: { codigo } }) => {
    const entrega = await SELECT.one.from(Entrega).where({ rastreio: codigo });
    if (!entrega) return { success: false, message: 'Código não encontrado' };

    return {
      success: true,
      message: 'Dados encontrados',
      geometry: entrega.rotaGeometry,
      etapasRota: entrega.etapasRota,
      statusEntrega: entrega.statusEntrega,
      horarioEntrega: entrega.horarioEntrega,
      distanciaKm: entrega.distanciaKm
    };
  });

  // ---------- ACTION atualizar -----------
  srv.on('atualizarStatusEntrega', async req => {
    const { codigo, novoStatus } = req.data;
    const tx = cds.tx(req);
  
    const entrega = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
    if (!entrega) return { success: false, message: 'Código não encontrado' };
  
    let horarioEntrega = entrega.horarioEntrega;
    if (novoStatus === 'ENTREGUE' && !horarioEntrega) {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      horarioEntrega = `${PERIOD(now.getHours())}-${h}:${m}`;
  
      // ✅ Deixa o veículo disponível novamente
      await tx.run(
        UPDATE(Veiculo)
          .set({ emUso: false, status: "Disponivel" })
          .where({ ID: entrega.veiculo_ID })
      );
    }
    await tx.run(
      UPDATE(Entrega).set({
        statusEntrega: novoStatus,
        horarioEntrega
      }).where({ ID: entrega.ID })
    );
  
    return {
      success: true,
      message: `Status alterado para ${novoStatus}`,
      horarioEntrega
    };
  });  
};
