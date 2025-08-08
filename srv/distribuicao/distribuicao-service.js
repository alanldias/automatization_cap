const buscarEndereco = require('./utils/buscarEndereco');
const buscarCoords = require('./utils/buscarCoordenadas');
const calcularRota = require('./utils/calcularRotasORS');
const selecionarVeiculoEcd = require('./utils/selecionarVeiculo');
const calcularRotaMultipla= require('./utils/calcularRotaMultipla');
const cds = require('@sap/cds');

module.exports = async function (srv) {
  const { Entrega, Veiculo, PedidosProntosEntrega, OcorrenciasEntrega } = srv.entities;

  const PERIOD = h => (h >= 8 && h < 12) ? 'Manha' : (h >= 12 && h < 18) ? 'Tarde' : 'Noite';

  // ---------- ACTION criar entrega -----------
  srv.on("realizarEntrega", async req => {
    const tx = cds.tx(req);
    let { pedidos } = req.data;

    // 2️⃣ compat: aceita formatos antigos
    if (!Array.isArray(pedidos)) {
      const { pedidoID, codigo, cepDestino, cep, numero } = req.data;
      const idPedido = pedidoID || codigo;
      const cepFinal = cepDestino || cep;
      if (idPedido && cepFinal) {
        pedidos = [{ pedidoID: idPedido, cep: cepFinal, numero: numero || "S/N" }];
      }
    }

    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      return { success: false, message: "Nenhum pedido informado." };
    }

    /** 1) Descobre UF por CEP (cache simples) */
    const cacheCEP = new Map();
    const pedidosComUF = [];
    for (const p of pedidos) {
      if (!cacheCEP.has(p.cep)) {
        const end = await buscarEndereco(p.cep); // ViaCEP
        cacheCEP.set(p.cep, end.estado);
      }
      pedidosComUF.push({ ...p, estado: cacheCEP.get(p.cep) });
    }

    /** 2) Agrupa por UF */
    const gruposPorUF = {};
    for (const p of pedidosComUF) (gruposPorUF[p.estado] ||= []).push(p);

    const respostas = [];

    /** 3) Processa por UF */
    for (const [estado, lista] of Object.entries(gruposPorUF)) {
      const selecao = await selecionarVeiculoEcd(estado);
      if (!selecao) {
        respostas.push({ success: false, message: `Nenhum veículo disponível em ${estado}` });
        continue;
      }
      const { veiculo, cd } = selecao;

      /* 3.1 Um pedido → rota simples */
      if (lista.length === 1) {
        const { pedidoID, cep, numero } = lista[0];

        const end     = await buscarEndereco(cep);
        const destino = await buscarCoords(`${end.rua} ${numero}, ${end.cidade}, ${end.estado}, ${cep}`);
        const origem  = cd.lat
          ? { lat: cd.lat, lon: cd.lon }
          : await buscarCoords(`${cd.endereco}, ${cd.cidade}, ${cd.estado}`);

        const { distanceKm, geometry, steps } = await calcularRota(origem, destino);
        const rastreio = `R${Math.trunc(Math.random() * 1_000_000)}`;

        await tx.run(INSERT.into(Entrega).entries({
          pedidoID,
          clienteNome: "Cliente Simulado",
          cepDestino: cep,
          cidadeDestino: end.cidade,
          estadoDestino: end.estado,
          enderecoCompleto: end.enderecoCompleto,
          distanciaKm: distanceKm,
          rotaGeometry: geometry,
          etapasRota: JSON.stringify(steps),
          transportadora: cd.nome,
          rastreio,
          statusEntrega: "CRIADA",
          dataEnvio: new Date(),
          veiculo_ID: veiculo.ID,
          centroDistribuicao_ID: cd.ID
        }));

        await tx.run(UPDATE(Veiculo).set({ emUso: true, status: "EmRota" }).where({ ID: veiculo.ID }));

        respostas.push({
          success: true,
          message: `Entrega criada a partir do CD ${cd.nome}`,
          geometry, steps, rastreio
        });
        continue;
      }

      /* 3.2 Vários pedidos → rota múltipla (tolerante a falhas por pedido) */
      const result = await calcularRotaMultipla(lista, cd);
      // result = { success, pedidosOrdenados, geometry, steps, destinos, distanceKm, falhas }

      // Se nada sobrou válido nesse estado
      if (!result.success || result.pedidosOrdenados.length === 0) {
        // Espelha falhas no "armazém" (opcional, mas útil)
        if (result.falhas?.length) {
          const idsFalha = result.falhas.map(f => f.pedidoID).filter(Boolean);
          if (idsFalha.length) {
            await tx.run(
              UPDATE(PedidosProntosEntrega)
                .set({ status: 'COM_PROBLEMAS', descricaoProblema: 'ROTA/GEOCODING_FALHOU' })
                .where({ pedidoID: { in: idsFalha } })
            );
          }
        }

        respostas.push({
          success: false,
          message: `Nenhuma entrega criada em ${estado}.`,
          falhas: result.falhas || []
        });
        continue;
      }

      const rastreioBase  = `R${Math.trunc(Math.random() * 1_000_000)}`;
      const rastreioCodes = result.pedidosOrdenados.map(p => `${rastreioBase}-${p.pedidoID}`);

      let criadas = 0;
      for (const [idx, p] of result.pedidosOrdenados.entries()) {
        try {
          await tx.run(INSERT.into(Entrega).entries({
            pedidoID: p.pedidoID,
            clienteNome: "Cliente Simulado",
            cepDestino: p.cep || "MULTIPONTO",
            cidadeDestino: p.end?.cidade || "-",
            estadoDestino: estado,
            enderecoCompleto: p.end?.enderecoCompleto || "-",
            distanciaKm: result.distanceKm ?? "-",             // total ou '-'
            rotaGeometry: result.geometry,
            etapasRota: JSON.stringify(result.steps),
            destinos: JSON.stringify(result.destinos),
            transportadora: cd.nome,
            sequenciaRastreios: JSON.stringify(rastreioCodes),
            rastreio: rastreioCodes[idx],
            statusEntrega: "CRIADA",
            dataEnvio: new Date(),
            veiculo_ID: veiculo.ID,
            centroDistribuicao_ID: cd.ID
          }));
          criadas++;
        } catch (e) {
          // Marca a falha deste pedido em memória pra responder
          result.falhas.push({ pedidoID: p.pedidoID, motivo: e.message || 'Falha ao inserir entrega' });
        }
      }

      // Atualiza veículo só se criou algo
      if (criadas > 0) {
        await tx.run(UPDATE(Veiculo).set({ emUso: true, status: "EmRota" }).where({ ID: veiculo.ID }));
      }

      // Espelha falhas no "armazém"
      if (result.falhas?.length) {
        const idsFalha = result.falhas.map(f => f.pedidoID).filter(Boolean);
        if (idsFalha.length) {
          await tx.run(
            UPDATE(PedidosProntosEntrega)
              .set({ status: 'COM_PROBLEMAS', descricaoProblema: 'ROTA/INSERCAO_FALHOU' })
              .where({ pedidoID: { in: idsFalha } })
          );
        }
      }

      respostas.push({
        success: criadas > 0 && !(result.falhas?.length),
        message: `Criadas ${criadas}/${lista.length} entregas a partir do CD ${cd.nome} (rota otimizada, tolerante a falhas).`,
        geometry: result.geometry,
        steps: result.steps,
        destinos: result.destinos,
        distanceKm: result.distanceKm,
        falhas: result.falhas || []
      });
    }

    /** 4) Retorno consolidado */
    return respostas.length === 1 ? respostas[0] : { success: true, resultados: respostas };
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
      destinos: entrega.destinos,
      sequenciaRastreios: entrega.sequenciaRastreios,
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
      horarioEntrega,
      pedidoID: entrega.pedidoID
    };
  });


  srv.on('atualizarStatusPedidos', async req => {
    const { pedidos, novoStatus } = req.data;
    const tx = cds.tx(req);

    if (!pedidos || pedidos.length === 0) {
      return { success: false, message: 'Nenhum pedido fornecido.', atualizados: 0 };
    }

    const result = await tx.run(
      UPDATE(PedidosProntosEntrega)
        .set({ status: novoStatus }) // 👈 agora é dinâmico
        .where({ pedidoID: { in: pedidos } })
    );

    return {
      success: true,
      message: `${result} pedido(s) atualizado(s) para ${novoStatus}.`,
      atualizados: result
    };
  });

  srv.on('confirmarEntregaOk', async (req) => {
    const { codigo } = req.data;
    const tx = cds.tx(req);

    const entrega = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
    if (!entrega) return { success: false, message: "Entrega não encontrada." };

    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const horarioEntrega = `${PERIOD(now.getHours())}-${h}:${m}`;

    await tx.run(
      UPDATE(Entrega).set({
        statusEntrega: 'ENTREGUE',
        horarioEntrega,
      }).where({ ID: entrega.ID })
    );

    if (entrega.pedidoID) {
      await tx.run(
        UPDATE(PedidosProntosEntrega).set({
          status: 'FINALIZADO'
        }).where({ pedidoID: entrega.pedidoID })
      );
    }

    return {
      success: true,
      message: "Entrega marcada como ENTREGUE",
      horarioEntrega
    };
  });

  srv.on('reagendarEntrega', async (req) => {
    const { codigo } = req.data;
    const tx = cds.tx(req);

    const entrega = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
    if (!entrega) return { success: false, message: "Entrega não encontrada." };

    await tx.run(
      UPDATE(Entrega).set({
        statusEntrega: 'REAGENDAR'
      }).where({ ID: entrega.ID })
    );

    if (!entrega.pedidoID) return { success: false, message: "PedidoID não encontrado na entrega." };

    await tx.run(
      UPDATE(PedidosProntosEntrega).set({
        status: 'PRONTO'
      }).where({ pedidoID: entrega.pedidoID })
    );

    return {
      success: true,
      message: "Entrega reagendada e pedido voltou para a fila.",
      pedidoID: entrega.pedidoID
    };
  });

  srv.on('registrarOcorrencia', async req => {
    const { codigo, tipo, observacao } = req.data
    const tx = cds.tx(req)                           // transação reusável

    /* 1. Busca a entrega pelo código de rastreio ------------------------ */
    const entrega = await tx.run(
      SELECT.one.from(Entrega).where({ rastreio: codigo })
    )
    if (!entrega) return { success: false, message: 'Entrega não encontrada' }

    /* 2. Registra a ocorrência ----------------------------------------- */
    await INSERT.into(OcorrenciasEntrega).entries({
      ID: cds.utils.uuid(),
      pedido_pedidoID: entrega.pedidoID,
      tipo,
      observacao,
      dataOcorrencia: new Date().toISOString(),
      criadoPor: req.user?.id || 'frontend'
    })

    /* 3. Atualiza a própria entrega ------------------------------------ */
    await UPDATE(Entrega)
      .set({
        status: 'COM_PROBLEMAS',
        descricaoProblema: tipo          // ou use "observacao"
      })
      .where({ ID: entrega.ID })

    /* 4. Espelha no “armazém” ------------------------------------------ */
    await UPDATE(PedidosProntosEntrega)
      .set({
        status: 'COM_PROBLEMAS',
        descricaoProblema: tipo          // mesmo motivo
      })
      .where({ pedidoID: entrega.pedidoID })

    /* 5. Done ----------------------------------------------------------- */
    return { success: true, message: 'Ocorrência registrada!' }
  });

};
