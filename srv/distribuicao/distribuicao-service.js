const buscarEndereco = require('./utils/buscarEndereco');
const buscarCoords = require('./utils/buscarCoordenadas');
const calcularRota = require('./utils/calcularRotasORS');
const calcularRotaMultipla = require('./utils/calcularRotaMultipla');
const cds = require('@sap/cds');
const LOG = cds.log('srv');

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

  const getPeriodo = h => (h >= 8 && h < 12) ? 'Manha' : (h >= 12 && h < 18) ? 'Tarde' : 'Noite';

  srv.on('listarVeiculosDisponiveis', async req => {
    try {
      const { centroId } = req.data;
      if (!centroId) req.reject(400, 'Centro de distribuição obrigatório.');

      const veiculos = await SELECT.from(Veiculo).where({
        centro_ID: centroId,
        emUso: false,
        status: 'Disponivel'
      });

      return veiculos.map(v => ({
        ID: v.ID,
        nome: v.nome,
        placa: v.placa,
        capacidade: v.capacidade,
        capacidadeAtual: v.capacidadeAtual || 0,
        capacidadeRestante: v.capacidade - (v.capacidadeAtual || 0),
        status: v.status
      }));
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao listar veículos disponíveis.');
    }
  });

  /** helper: geocode + preencher lat/lon de um pedido */
  async function preencherCoordsPedido(tx, pedido) {
    try {
      const cepOk = cepValido(pedido.cep);
      if (!cepOk) return { ok: false, motivo: 'CEP_FORMATO_INVALIDO' };

      const end = await buscarEndereco(cepOk);
      const coords = await buscarCoords(
        `${end.logradouro || end.rua || ''} ${pedido.numero || 'S/N'}, ${end.localidade || end.cidade}, ${end.uf || end.estado}, Brasil, ${cepOk}`,
        {
          street: `${end.logradouro || end.rua || ''} ${pedido.numero || ''}`.trim(),
          city: end.localidade || end.cidade,
          state: end.uf || end.estado,
          postalcode: cepOk,
          suburb: end.bairro || ''
        }
      );

      await tx.run(
        UPDATE(PedidosProntosEntrega).set({
          lat: coords.lat, lon: coords.lon,
          cidade: end.cidade, estado: end.estado,
          cep: cepOk
        }).where({ pedidoID: pedido.pedidoID })
      );
      return { ok: true };
    } catch (err) {
      LOG.error(err);
      return { ok: false, motivo: 'ERRO_COORDS' };
    }
  }

  /** B) Selecionar pedidos para um veículo (só aloca, NÃO despacha) */
  srv.on('selecionarPedidosParaVeiculo', async req => {
    try {
      const tx = cds.tx(req);
      const { veiculoId, pedidos } = req.data;

      if (!Array.isArray(pedidos) || pedidos.length === 0) {
        return { success: false, message: 'Nenhum pedido informado.', selecionados: 0, rejeitados: 0, capacidadeRestante: 0 };
      }

      const veiculo = await tx.run(SELECT.one.from(Veiculo).where({ ID: veiculoId }));
      if (!veiculo) return { success: false, message: 'Veículo não encontrado', selecionados: 0, rejeitados: pedidos.length, capacidadeRestante: 0 };

      const restante = veiculo.capacidade - (veiculo.capacidadeAtual || 0);

      // carrega pedidos
      const rows = await tx.run(SELECT.from(PedidosProntosEntrega).where({ pedidoID: { in: pedidos } }));

      let selecionados = 0;
      const falhas = [];

      // 1) BARRA pedidos de outro centro
      const rowsMesmoCentro = [];
      for (const p of rows) {
        if (p.centro_ID !== veiculo.centro_ID) {
          falhas.push({ pedidoID: p.pedidoID, motivo: 'CENTRO_DIFERENTE' });
          continue;
        }
        rowsMesmoCentro.push(p);
      }

      // 2) aplica restante (aceita parcial, se quiser manter seu comportamento anterior, pule este clamp)
      const processaveis = rowsMesmoCentro.slice(0, Math.max(0, restante));

      for (const p of processaveis) {
        // CEP / coords
        if (!cepValido(p.cep)) {
          falhas.push({ pedidoID: p.pedidoID, motivo: 'CEP_FORMATO_INVALIDO' });
          await tx.run(
            UPDATE(PedidosProntosEntrega)
              .set({ status: 'COM_PROBLEMAS', descricaoProblema: 'CEP inválido (use 99999-999)' })
              .where({ pedidoID: p.pedidoID, centro_ID: veiculo.centro_ID }) // 👈 defesa extra
          );
          continue;
        }

        const r = await preencherCoordsPedido(tx, p);
        if (!r.ok) {
          falhas.push({ pedidoID: p.pedidoID, motivo: r.motivo });
          await tx.run(
            UPDATE(PedidosProntosEntrega)
              .set({ status: 'COM_PROBLEMAS', descricaoProblema: r.motivo })
              .where({ pedidoID: p.pedidoID, centro_ID: veiculo.centro_ID }) // 👈 defesa extra
          );
          continue;
        }

        // 3) aloca garantindo centro
        const linhas = await tx.run(
          UPDATE(PedidosProntosEntrega)
            .set({ status: 'SELECIONADO', veiculo_ID: veiculoId })
            .where({ pedidoID: p.pedidoID, centro_ID: veiculo.centro_ID }) // 👈 crucial
        );

        if (linhas > 0) selecionados++;
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
        message:
          (falhas.length ? `Selecionados ${selecionados}. ${falhas.length} rejeitado(s).` : `Selecionados ${selecionados}.`) +
          (rowsMesmoCentro.length < rows.length ? " (Alguns pedidos eram de outro centro.)" : ""),
        selecionados,
        rejeitados: falhas.length,
        capacidadeRestante: veiculo.capacidade - ((veiculo.capacidadeAtual || 0) + selecionados),
        falhas
      };
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao selecionar pedidos para veículo.');
    }
  });

  /** C) Despachar veículo: cria entregas + ORS e põe veículo em rota */
  srv.on('despacharVeiculo', async req => {
    try {
      const tx = cds.tx(req);
      const { veiculoId } = req.data;

      // helper local: coordenada dentro do Brasil
      const isCoordInBrazil = (lat, lon) => {
        if (lat == null || lon == null) return false;
        const LAT_MIN = -35, LAT_MAX = 6;
        const LON_MIN = -75, LON_MAX = -32;
        return lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;
      };

      const veiculo = await tx.run(SELECT.one.from(Veiculo).where({ ID: veiculoId }));
      if (!veiculo) return { success: false, message: 'Veículo não encontrado' };

      const cd = await tx.run(SELECT.one.from(CentroDistribuicao).where({ ID: veiculo.centro_ID }));
      if (!cd) return { success: false, message: 'Centro do veículo não encontrado' };

      const pedidos = await tx.run(
        SELECT.from(PedidosProntosEntrega).where({ veiculo_ID: veiculoId, status: 'SELECIONADO' })
      );
      if (!pedidos.length) return { success: false, message: 'Nenhum pedido selecionado neste veículo' };

      const origem = cd.lat && cd.lon ? { lat: cd.lat, lon: cd.lon } : null;

      // garante coords para todos; marca problema se falhar
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

      // reconsulta válidos (com lat/lon) e filtra fora do BR
      let validos = await tx.run(
        SELECT.from(PedidosProntosEntrega).where({
          veiculo_ID: veiculoId,
          status: 'SELECIONADO',
          lat: { '!=': null },
          lon: { '!=': null }
        })
      );
      validos = validos.filter(v => isCoordInBrazil(v.lat, v.lon));

      if (!validos.length) {
        return { success: false, message: 'Nenhum pedido com coordenadas válidas para despachar' };
      }

      let geometry, steps, destinosArr, distanceKm;

      if (validos.length === 1) {
        // rota unitária
        const destino = { lat: validos[0].lat, lon: validos[0].lon };
        const origemCoords = origem || await buscarCoords(`${cd.endereco}, ${cd.cidade}, ${cd.estado}, Brasil`);
        const r = await calcularRota(origemCoords, destino);
        ({ geometry, steps, distanceKm } = r);
        destinosArr = [[destino.lat, destino.lon]];

        // rastreio + sequência
        const rastreioBase = `R${Math.trunc(Math.random() * 1_000_000)}`;
        const rastreio = `${rastreioBase}-${validos[0].pedidoID}`;
        const sequenciaStr = JSON.stringify([rastreio]);

        await tx.run(
          INSERT.into(Entrega).entries({
            pedidoID: validos[0].pedidoID,
            clienteNome: validos[0].clienteNome,
            cepDestino: validos[0].cep,
            cidadeDestino: validos[0].cidade,
            estadoDestino: validos[0].estado,
            enderecoCompleto: `${validos[0].cidade} - ${validos[0].estado}`,
            distanciaKm: distanceKm,
            rotaGeometry: geometry,
            etapasRota: JSON.stringify(steps),
            destinos: JSON.stringify(destinosArr),
            transportadora: cd.nome,
            rastreio,
            statusEntrega: 'CRIADA',
            dataEnvio: new Date(),
            veiculo_ID: veiculoId,
            centroDistribuicao_ID: cd.ID,
            ordemParada: 0,
            sequenciaRastreios: sequenciaStr
          })
        );

        await tx.run(
          UPDATE(PedidosProntosEntrega).set({ status: 'ENVIADO' })
            .where({ veiculo_ID: veiculoId, status: 'SELECIONADO' })
        );
        await tx.run(UPDATE(Veiculo).set({ emUso: true, status: 'EmRota' }).where({ ID: veiculoId }));

        return {
          success: true,
          message: `Despachado com 1 pedido`,
          geometry,
          steps,
          rastreios: sequenciaStr,
          totalPedidos: 1
        };
      }

      // rota múltipla (usar ordem do otimizador)
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
      ({ geometry, steps, destinos: destinosArr, distanceKm } = r);

      // rastreios na MESMA ORDEM da rota
      const rastreioBase = `R${Math.trunc(Math.random() * 1_000_000)}`;
      const rastreiosOrdenados = r.pedidosOrdenados.map(p => `${rastreioBase}-${p.pedidoID}`);
      const sequenciaStr = JSON.stringify(rastreiosOrdenados);
      const destinosStr = JSON.stringify(Array.isArray(destinosArr) ? destinosArr : []);

      // inserir ENTREGAS seguindo pedidosOrdenados
      for (let i = 0; i < r.pedidosOrdenados.length; i++) {
        const p = r.pedidosOrdenados[i]; // { pedidoID, ... }
        const full = validos.find(v => v.pedidoID === p.pedidoID);
        const rastreio = rastreiosOrdenados[i];

        await tx.run(
          INSERT.into(Entrega).entries({
            pedidoID: p.pedidoID,
            clienteNome: full?.clienteNome,
            cepDestino: full?.cep,
            cidadeDestino: full?.cidade,
            estadoDestino: full?.estado,
            enderecoCompleto: `${full?.cidade} - ${full?.estado}`,
            distanciaKm: distanceKm,
            rotaGeometry: geometry,
            etapasRota: JSON.stringify(steps),
            destinos: destinosStr,
            transportadora: cd.nome,
            rastreio,
            statusEntrega: 'CRIADA',
            dataEnvio: new Date(),
            veiculo_ID: veiculoId,
            centroDistribuicao_ID: cd.ID,
            ordemParada: i,
            sequenciaRastreios: sequenciaStr
          })
        );
      }

      await tx.run(
        UPDATE(PedidosProntosEntrega).set({ status: 'ENVIADO' })
          .where({ veiculo_ID: veiculoId, status: 'SELECIONADO' })
      );
      await tx.run(UPDATE(Veiculo).set({ emUso: true, status: 'EmRota' }).where({ ID: veiculoId }));

      return {
        success: true,
        message: `Despachado com ${validos.length} pedidos`,
        geometry,
        steps,
        rastreios: sequenciaStr, // já na ordem da rota
        totalPedidos: validos.length
      };
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao despachar veículo.');
    }
  });

  /** D) Desalocar pedidos (rollback da seleção antes de despachar) */
  srv.on('desalocarPedidos', async req => {
    try {
      const tx = cds.tx(req);
      const { veiculoId, pedidos } = req.data;

      const rows = await tx.run(
        SELECT.from(PedidosProntosEntrega).where({ veiculo_ID: veiculoId, pedidoID: { in: pedidos }, status: 'SELECIONADO' })
      );
      if (!rows.length) {
        return { success: false, message: 'Nenhum pedido SELECIONADO encontrado nesse veículo', removidos: 0, capacidadeRestante: 0 };
      }

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
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao desalocar pedidos.');
    }
  });

  srv.on('encerrarRotaDoVeiculo', async req => {
    try {
      const { codigo } = req.data;
      if (!codigo) req.reject(400, 'Código obrigatório.');

      const tx = cds.tx(req);

      const entrega = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
      if (!entrega) return { success: false, message: 'Entrega não encontrada.' };

      const abertas = await tx.run(
        SELECT.from(Entrega).columns('ID')
          .where({ veiculo_ID: entrega.veiculo_ID, statusEntrega: { in: ['CRIADA', 'EM_TRANSITO'] } })
      );
      if (abertas.length > 0) {
        return { success: false, message: 'Ainda há entregas em andamento neste veículo.' };
      }

      await tx.run(
        UPDATE(PedidosProntosEntrega).set({ veiculo_ID: null })
          .where({ veiculo_ID: entrega.veiculo_ID })
      );

      await tx.run(
        UPDATE(Veiculo)
          .set({ emUso: false, status: 'Disponivel', capacidadeAtual: 0 })
          .where({ ID: entrega.veiculo_ID })
      );

      return { success: true, message: 'Veículo liberado e pedidos desassociados.' };
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao encerrar rota do veículo.');
    }
  });
  // ---------- ACTION rastrear -----------
  srv.on('rastrearEntrega', async req => {
    try {
      const { codigo } = req.data;
      if (!codigo) req.reject(400, 'Código obrigatório.');

      const entrega = await SELECT.one.from(Entrega).where({ rastreio: codigo });
      if (!entrega) return { success: false, message: 'Código não encontrado.' };

      let sequencia = entrega.sequenciaRastreios;
      if (!sequencia) {
        const irmas = await SELECT.from(Entrega)
          .columns('rastreio')
          .where({
            veiculo_ID: entrega.veiculo_ID,
            rotaGeometry: entrega.rotaGeometry,
            dataEnvio: entrega.dataEnvio
          })
          .orderBy('createdAt asc');

        if (irmas?.length) {
          sequencia = JSON.stringify(irmas.map(r => r.rastreio));
        }
      }

      return {
        success: true,
        message: 'Dados encontrados',
        geometry: entrega.rotaGeometry,
        etapasRota: entrega.etapasRota,
        destinos: entrega.destinos,
        sequenciaRastreios: sequencia || JSON.stringify([entrega.rastreio]),
        statusEntrega: entrega.statusEntrega,
        horarioEntrega: entrega.horarioEntrega,
        distanciaKm: entrega.distanciaKm
      };
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao rastrear entrega.');
    }
  });

  srv.on('atualizarStatusPedidos', async req => {
    try {
      const { pedidos, novoStatus } = req.data;
      const tx = cds.tx(req);

      if (!pedidos || pedidos.length === 0) {
        return { success: false, message: 'Nenhum pedido fornecido.', atualizados: 0 };
      }

      const result = await tx.run(
        UPDATE(PedidosProntosEntrega)
          .set({ status: novoStatus })
          .where({ pedidoID: { in: pedidos } })
      );

      return {
        success: true,
        message: `${result} pedido(s) atualizado(s) para ${novoStatus}.`,
        atualizados: result
      };
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao atualizar status dos pedidos.');
    }
  });

  srv.on('confirmarEntregaOk', async req => {
    try {
      const { codigo } = req.data;
      if (!codigo) req.reject(400, 'Código obrigatório.');

      const tx = cds.tx(req);
      const entrega = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
      if (!entrega) return { success: false, message: 'Entrega não encontrada.' };

      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const horarioEntrega = `${getPeriodo(now.getHours())}-${h}:${m}`;

      await tx.run(
        UPDATE(Entrega).set({ statusEntrega: 'ENTREGUE', horarioEntrega }).where({ ID: entrega.ID })
      );

      if (entrega.pedidoID) {
        await tx.run(
          UPDATE(PedidosProntosEntrega).set({ status: 'FINALIZADO' }).where({ pedidoID: entrega.pedidoID })
        );
      }

      return { success: true, message: 'Entrega marcada como ENTREGUE.', horarioEntrega };
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao confirmar entrega.');
    }
  });

  srv.on('reagendarEntrega', async req => {
    try {
      const { codigo } = req.data;
      if (!codigo) req.reject(400, 'Código ausente.');

      const tx = cds.tx(req);

      const ent = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
      if (!ent) return { success: false, message: 'Entrega não encontrada.' };

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

      await tx.run(
        UPDATE(Entrega).set({
          statusEntrega: 'REAGENDAR',
          descricaoProblema: 'Cliente ausente - reagendar'
        }).where({ ID: ent.ID })
      );

      const linhas = await tx.run(
        UPDATE(PedidosProntosEntrega)
          .set({
            status: 'PRONTO',
            veiculo_ID: null,
            descricaoProblema: 'Cliente ausente nova tentativa'
          })
          .where({ pedidoID: ent.pedidoID })
      );

      LOG.debug(`[REAGENDAR] pedido ${ent.pedidoID} → PRONTO (linhas: ${linhas})`);
      return { success: true, message: 'Entrega reagendada. Pedido voltou para a fila.', pedidoID: ent.pedidoID };
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao reagendar entrega.');
    }
  });


  const LABEL_TIPO = {
    CLIENTE_DESCONHECE: 'Cliente não reconhece o pedido',
    ENDERECO_INVALIDO: 'Endereço não encontrado',
    PEDIDO_ERRADO: 'Pedido errado',
    CLIENTE_NAO_ESTA: 'Cliente ausente'
  };

  srv.on('registrarOcorrencia', async req => {
    try {
      const { codigo, tipo, observacao } = req.data;
      const tx = cds.tx(req);

      const entrega = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
      if (!entrega) return { success: false, message: 'Entrega não encontrada' };

      const desc = (observacao && observacao.trim()) || LABEL_TIPO[tipo] || String(tipo);

      await tx.run(
        INSERT.into(OcorrenciasEntrega).entries({
          ID: cds.utils.uuid(),
          pedido_pedidoID: entrega.pedidoID,
          tipo,
          observacao: desc,
          dataOcorrencia: new Date().toISOString(),
          criadoPor: req.user?.id || 'frontend'
        })
      );

      await tx.run(
        UPDATE(Entrega)
          .set({ statusEntrega: 'COM_PROBLEMAS', descricaoProblema: desc })
          .where({ ID: entrega.ID })
      );

      await tx.run(
        UPDATE(PedidosProntosEntrega)
          .set({ status: 'COM_PROBLEMAS', descricaoProblema: desc })
          .where({ pedidoID: entrega.pedidoID })
      );

      return { success: true, message: 'Ocorrência registrada!' };
    } catch (err) {
      LOG.error(err);
      req.error(500, 'Erro ao registrar ocorrência.');
    }
  });

};
