const buscarEndereco = require('./utils/buscarEndereco');
const buscarCoords = require('./utils/buscarCoordenadas');
const calcularRota = require('./utils/calcularRotasORS');
const selecionarVeiculoEcd = require('./utils/selecionarVeiculo');
const calcularRotaMultipla = require('./utils/calcularRotaMultipla');
const cds = require('@sap/cds');

const CEP_REGEX = /^\d{5}-?\d{3}$/;
function normalizaCep(cep) {
  if (!cep) return null;
  const dig = String(cep).replace(/\D/g, '');
  if (dig.length !== 8) return null;
  return `${dig.slice(0, 5)}-${dig.slice(5)}`;
}
function cepValido(cep) {
  const norm = normalizaCep(cep);
  return norm && CEP_REGEX.test(norm) ? norm : null;
}

module.exports = async function (srv) {
  const { Entrega, Veiculo, PedidosProntosEntrega, OcorrenciasEntrega, CentroDistribuicao } = srv.entities;

  const PERIOD = h => (h >= 8 && h < 12) ? 'Manha' : (h >= 12 && h < 18) ? 'Tarde' : 'Noite';

  this.on('listarVeiculosDisponiveis', async req => {
    const { centroId } = req.data;
    const veiculos = await SELECT.from(Veiculo).where({
      centro_ID: centroId, emUso: false, status: 'Disponivel'
    });

    return veiculos.map(v => ({
      ID: v.ID,
      nome: v.nome,
      placa: v.placa,
      capacidade: v.capacidade,
      capacidadeAtual: v.capacidadeAtual || 0,
      capacidadeRestante: (v.capacidade - (v.capacidadeAtual || 0)),
      status: v.status
    }));
  });

  /** helper: geocode + preencher lat/lon de um pedido */
  async function preencherCoordsPedido(tx, pedido) {
    try {
      const cepOk = cepValido(pedido.cep);
      if (!cepOk) throw new Error('CEP_FORMATO_INVALIDO');

      const end = await buscarEndereco(cepOk); // sua função já consulta ViaCEP/Nominatim
      const coords = await buscarCoords(`${end.rua} ${pedido.numero || 'S/N'}, ${end.cidade}, ${end.estado}, ${cepOk}`);

      await tx.run(
        UPDATE(PedidosProntosEntrega).set({
          lat: coords.lat, lon: coords.lon,
          cidade: end.cidade, estado: end.estado,
          cep: cepOk // 👈 salva normalizado, se quiser
        }).where({ pedidoID: pedido.pedidoID })
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: e?.message || 'COORDS_FAIL' };
    }
  }

  /** B) Selecionar pedidos para um veículo (só aloca, NÃO despacha) */
  this.on('selecionarPedidosParaVeiculo', async req => {
    const tx = cds.tx(req);
    const { veiculoId, pedidos } = req.data;

    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      return { success: false, message: 'Nenhum pedido informado.', selecionados: 0, rejeitados: 0, capacidadeRestante: 0 };
    }

    const veiculo = await tx.run(SELECT.one.from(Veiculo).where({ ID: veiculoId }));
    if (!veiculo) return { success: false, message: 'Veículo não encontrado', selecionados: 0, rejeitados: pedidos.length, capacidadeRestante: 0 };

    const restante = (veiculo.capacidade - (veiculo.capacidadeAtual || 0));
    if (pedidos.length > restante) {
      return {
        success: false,
        message: `Esse caminhão aguenta só ${restante} pedidos, remova ${pedidos.length - restante}.`,
        selecionados: 0, rejeitados: pedidos.length, capacidadeRestante: restante
      };
    }

    // carrega pedidos
    const rows = await tx.run(
      SELECT.from(PedidosProntosEntrega).where({ pedidoID: { in: pedidos } })
    );

    let selecionados = 0;
    const falhas = [];

    for (const p of rows) {
      // 🔎 valida formato antes de tentar geocodificar
      if (!cepValido(p.cep)) {
        falhas.push({ pedidoID: p.pedidoID, motivo: 'CEP_FORMATO_INVALIDO' });
        await tx.run(
          UPDATE(PedidosProntosEntrega)
            .set({ status: 'COM_PROBLEMAS', descricaoProblema: 'CEP inválido (use 99999-999)' })
            .where({ pedidoID: p.pedidoID })
        );
        continue;
      }

      const r = await preencherCoordsPedido(tx, p);
      if (!r.ok) {
        falhas.push({ pedidoID: p.pedidoID, motivo: r.motivo });
        await tx.run(
          UPDATE(PedidosProntosEntrega)
            .set({ status: 'COM_PROBLEMAS', descricaoProblema: r.motivo })
            .where({ pedidoID: p.pedidoID })
        );
        continue;
      }

      await tx.run(
        UPDATE(PedidosProntosEntrega)
          .set({ status: 'SELECIONADO', veiculo_ID: veiculoId })
          .where({ pedidoID: p.pedidoID })
      );
      selecionados++;
    }

    if (selecionados > 0) {
      await tx.run(
        UPDATE(Veiculo)
          .set({ capacidadeAtual: (veiculo.capacidadeAtual || 0) + selecionados })
          .where({ ID: veiculoId })
      );
    }

    return {
      success: selecionados > 0,
      message: falhas.length
        ? `Selecionados ${selecionados}. ${falhas.length} com problema.`
        : `Selecionados ${selecionados}.`,
      selecionados,
      rejeitados: falhas.length,
      capacidadeRestante: (veiculo.capacidade - ((veiculo.capacidadeAtual || 0) + selecionados)),
      falhas // 👈 devolve estruturado (se preferir manter compat, tbm faça falhas: JSON.stringify(falhas))
    };
  });

  /** C) Despachar veículo: cria entregas + ORS e põe veículo em rota */
  this.on('despacharVeiculo', async req => {
    const tx = cds.tx(req);
    const { veiculoId } = req.data;

    const veiculo = await tx.run(SELECT.one.from(Veiculo).where({ ID: veiculoId }));
    if (!veiculo) return { success: false, message: 'Veículo não encontrado' };

    const cd = await tx.run(SELECT.one.from(CentroDistribuicao).where({ ID: veiculo.centro_ID }));
    if (!cd) return { success: false, message: 'Centro do veículo não encontrado' };

    const pedidos = await tx.run(
      SELECT.from(PedidosProntosEntrega).where({ veiculo_ID: veiculoId, status: 'SELECIONADO' })
    );
    if (!pedidos.length) return { success: false, message: 'Nenhum pedido selecionado neste veículo' };

    // origem do CD
    const origem = cd.lat && cd.lon
      ? { lat: cd.lat, lon: cd.lon }
      : null;

    // garante coords de todos (se faltou, tenta buscar)
    for (const p of pedidos) {
      if (p.lat == null || p.lon == null) {
        const r = await preencherCoordsPedido(tx, p);
        if (!r.ok) {
          await tx.run(
            UPDATE(PedidosProntosEntrega)
              .set({ status: 'COM_PROBLEMAS', descricaoProblema: r.motivo })
              .where({ pedidoID: p.pedidoID })
          );
        }
      }
    }

    // refaz a lista apenas com os válidos
    const validos = await tx.run(
      SELECT.from(PedidosProntosEntrega).where({ veiculo_ID: veiculoId, status: 'SELECIONADO', lat: { '!=': null }, lon: { '!=': null } })
    );
    if (!validos.length) {
      return { success: false, message: 'Nenhum pedido com coordenadas válidas para despachar' };
    }

    // rota unitária vs múltipla
    let geometry, steps, destinos, distanceKm;
    if (validos.length === 1) {
      const destino = { lat: validos[0].lat, lon: validos[0].lon };
      const origemCoords = origem || await buscarCoords(`${cd.endereco}, ${cd.cidade}, ${cd.estado}`);
      const r = await calcularRota(origemCoords, destino);
      ({ geometry, steps, distanceKm } = r);
      destinos = JSON.stringify([[destino.lat, destino.lon]]);
    } else {
      // adaptar seu calcularRotaMultipla para aceitar coords se já existirem
      const lista = validos.map(v => ({
        pedidoID: v.pedidoID,
        cep: v.cep,
        numero: v.numero,
        coords: { lat: v.lat, lon: v.lon }
      }));
      const r = await calcularRotaMultipla(lista, cd, { preferirCoords: true });
      if (!r.success || r.pedidosOrdenados.length === 0) {
        return { success: false, message: 'Falha ao calcular rota múltipla', steps: null, geometry: null };
      }
      ({ geometry, steps, destinos, distanceKm } = r);
    }

    // cria entregas (1 por pedido, preservando “rastreio base”)
    const rastreioBase = `R${Math.trunc(Math.random() * 1_000_000)}`;
    const rastreios = [];

    for (let i = 0; i < validos.length; i++) {
      const p = validos[i];
      const rastreio = `${rastreioBase}-${p.pedidoID}`;
      rastreios.push(rastreio);

      await tx.run(
        INSERT.into(Entrega).entries({
          pedidoID: p.pedidoID,
          clienteNome: p.clienteNome,
          cepDestino: p.cep,
          cidadeDestino: p.cidade,
          estadoDestino: p.estado,
          enderecoCompleto: `${p.cidade} - ${p.estado}`,
          distanciaKm: distanceKm,
          rotaGeometry: geometry,
          etapasRota: JSON.stringify(steps),
          destinos: destinos,
          transportadora: cd.nome,
          rastreio,
          statusEntrega: 'CRIADA',
          dataEnvio: new Date(),
          veiculo_ID: veiculoId,
          centroDistribuicao_ID: cd.ID
        })
      );
    }

    // marca pedidos como ENVIADO, veículo em rota
    await tx.run(
      UPDATE(PedidosProntosEntrega).set({ status: 'ENVIADO' })
        .where({ veiculo_ID: veiculoId, status: 'SELECIONADO' })
    );
    await tx.run(
      UPDATE(Veiculo).set({ emUso: true, status: 'EmRota' }).where({ ID: veiculoId })
    );

    return {
      success: true,
      message: `Despachado com ${validos.length} pedidos`,
      geometry, steps,
      rastreios: JSON.stringify(rastreios),
      totalPedidos: validos.length
    };
  });

  /** D) Desalocar pedidos (rollback da seleção antes de despachar) */
  this.on('desalocarPedidos', async req => {
    const tx = cds.tx(req);
    const { veiculoId, pedidos } = req.data;

    const rows = await tx.run(
      SELECT.from(PedidosProntosEntrega).where({ veiculo_ID: veiculoId, pedidoID: { in: pedidos }, status: 'SELECIONADO' })
    );
    if (!rows.length) return { success: false, message: 'Nenhum pedido SELECIONADO encontrado nesse veículo', removidos: 0, capacidadeRestante: 0 };

    const removidos = rows.length;

    await tx.run(
      UPDATE(PedidosProntosEntrega)
        .set({ status: 'PRONTO', veiculo_ID: null })
        .where({ veiculo_ID: veiculoId, pedidoID: { in: pedidos } })
    );

    const v = await tx.run(SELECT.one.from(Veiculo).where({ ID: veiculoId }));
    const novaCap = Math.max(0, (v.capacidadeAtual || 0) - removidos);
    await tx.run(UPDATE(Veiculo).set({ capacidadeAtual: novaCap }).where({ ID: veiculoId }));

    return {
      success: true,
      message: `Removidos ${removidos} pedidos do veículo`,
      removidos,
      capacidadeRestante: v.capacidade - novaCap
    };
  });

  srv.on('encerrarRotaDoVeiculo', async req => {
    const { codigo } = req.data;
    const tx = cds.tx(req);
    const { Entrega, Veiculo, PedidosProntosEntrega } = srv.entities;

    if (!codigo) return { success: false, message: 'Código ausente.' };

    // 1) Achar a entrega pelo rastreio p/ descobrir o veículo
    const ent = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
    if (!ent) return { success: false, message: 'Entrega não encontrada pelo código.' };
    if (!ent.veiculo_ID) return { success: false, message: 'Entrega não possui veículo associado.' };

    const veiculoId = ent.veiculo_ID;

    // 2) Só libera se não houver entregas "em aberto" nesse veículo
    //    (consideramos abertas: CRIADA/EM_TRANSITO)
    const abertas = await tx.run(
      SELECT.from(Entrega).columns('ID')
        .where({ veiculo_ID: veiculoId, statusEntrega: { in: ['CRIADA', 'EM_TRANSITO'] } })
    );
    if (abertas.length > 0) {
      return { success: false, message: 'Ainda há entregas em andamento neste veículo.' };
    }

    // 3) Desassocia qualquer pedido do armazém que ainda esteja com esse veículo
    await tx.run(
      UPDATE(PedidosProntosEntrega)
        .set({ veiculo_ID: null })
        .where({ veiculo_ID: veiculoId })
    );

    // 4) Reseta o veículo
    await tx.run(
      UPDATE(Veiculo)
        .set({ emUso: false, status: 'Disponivel', capacidadeAtual: 0 })
        .where({ ID: veiculoId })
    );

    return { success: true, message: 'Veículo liberado e pedidos desassociados.' };
  });


  // ---------- ACTION rastrear -----------
  srv.on('rastrearEntrega', async ({ data: { codigo } }) => {
    const e = await SELECT.one.from(Entrega).where({ rastreio: codigo });
    if (!e) return { success: false, message: 'Código não encontrado' };

    let sequencia = e.sequenciaRastreios;
    if (!sequencia) {
      const irmas = await SELECT.from(Entrega)
        .columns('rastreio')
        .where({
          veiculo_ID: e.veiculo_ID,
          rotaGeometry: e.rotaGeometry,
          dataEnvio: e.dataEnvio
        })
        .orderBy('createdAt asc');

      if (irmas?.length) {
        sequencia = JSON.stringify(irmas.map(r => r.rastreio));
      }
    }

    return {
      success: true,
      message: 'Dados encontrados',
      geometry: e.rotaGeometry,
      etapasRota: e.etapasRota,
      destinos: e.destinos,
      sequenciaRastreios: sequencia || JSON.stringify([e.rastreio]),
      statusEntrega: e.statusEntrega,
      horarioEntrega: e.horarioEntrega,
      distanciaKm: e.distanciaKm
    };
  });

  // ---------- ACTION atualizar -----------
  srv.on('rastrearEntrega', async ({ data: { codigo } }) => {
    const e = await SELECT.one.from(Entrega).where({ rastreio: codigo });
    if (!e) return { success: false, message: 'Código não encontrado' };

    let sequencia = e.sequenciaRastreios;
    if (!sequencia) {
      const irmas = await SELECT.from(Entrega)
        .columns('rastreio')
        .where({
          veiculo_ID: e.veiculo_ID,
          rotaGeometry: e.rotaGeometry,
          dataEnvio: e.dataEnvio
        })
        .orderBy('createdAt asc');

      if (irmas?.length) {
        sequencia = JSON.stringify(irmas.map(r => r.rastreio));
      }
    }

    return {
      success: true,
      message: 'Dados encontrados',
      geometry: e.rotaGeometry,
      etapasRota: e.etapasRota,
      destinos: e.destinos,
      sequenciaRastreios: sequencia || JSON.stringify([e.rastreio]),
      statusEntrega: e.statusEntrega,
      horarioEntrega: e.horarioEntrega,
      distanciaKm: e.distanciaKm
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

  srv.on('reagendarEntrega', async req => {
    const { codigo } = req.data;
    if (!codigo) return { success: false, message: 'Código ausente.' };

    const tx = cds.tx(req);

    // 1) Busca entrega
    const ent = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
    if (!ent) return { success: false, message: 'Entrega não encontrada.' };

    // 2) (Novo) Registra ocorrência para auditoria, mas sem marcar COM_PROBLEMAS
    await tx.run(
      INSERT.into(OcorrenciasEntrega).entries({
        ID: cds.utils.uuid(),
        pedido_pedidoID: ent.pedidoID,
        tipo: 'CLIENTE_NAO_ESTA',
        observacao: 'Cliente ausente - reagendar',
        dataOcorrencia: new Date().toISOString(),
        criadoPor: req.user?.id || 'frontend'
      })
    );

    // 3) Marca entrega para reagendar (mantém sem “quebrar”)
    await tx.run(
      UPDATE(Entrega).set({
        statusEntrega: 'REAGENDAR',
        descricaoProblema: 'Cliente ausente - reagendar'
      }).where({ ID: ent.ID })
    );

    // 4) Devolve o pedido para a fila (PRONTO) e limpa vínculo do veículo
    const linhas = await tx.run(
      UPDATE(PedidosProntosEntrega)
        .set({
          status: 'PRONTO',
          veiculo_ID: null,
          descricaoProblema: 'Cliente ausente nova tentativa' // opcional: limpa “vermelho” no grid
        })
        .where({ pedidoID: ent.pedidoID })
    );

    console.log(`[REAGENDAR] pedido ${ent.pedidoID} → PRONTO (linhas: ${linhas})`);
    return { success: true, message: 'Entrega reagendada. Pedido voltou para a fila.', pedidoID: ent.pedidoID };
  });

  const LABEL_TIPO = {
    CLIENTE_DESCONHECE: 'Cliente não reconhece o pedido',
    ENDERECO_INVALIDO: 'Endereço não encontrado',
    PEDIDO_ERRADO: 'Pedido errado',
    CLIENTE_NAO_ESTA: 'Cliente ausente'
  };

  srv.on('registrarOcorrencia', async req => {
    const { codigo, tipo, observacao } = req.data;
    const tx = cds.tx(req);

    const entrega = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
    if (!entrega) return { success: false, message: 'Entrega não encontrada' };

    // usa a observação se veio; senão cai pro label do tipo; senão pro próprio tipo
    const desc = (observacao && observacao.trim()) || LABEL_TIPO[tipo] || String(tipo);

    await INSERT.into(OcorrenciasEntrega).entries({
      ID: cds.utils.uuid(),
      pedido_pedidoID: entrega.pedidoID,
      tipo,
      observacao: desc,              // 👈 salva o texto final aqui
      dataOcorrencia: new Date().toISOString(),
      criadoPor: req.user?.id || 'frontend'
    });

    // marca a entrega
    await UPDATE(Entrega)
      .set({ statusEntrega: 'COM_PROBLEMAS', descricaoProblema: desc })
      .where({ ID: entrega.ID });

    // espelha no “armazém”
    await UPDATE(PedidosProntosEntrega)
      .set({ status: 'COM_PROBLEMAS', descricaoProblema: desc })
      .where({ pedidoID: entrega.pedidoID });

    return { success: true, message: 'Ocorrência registrada!' };
  });

};
