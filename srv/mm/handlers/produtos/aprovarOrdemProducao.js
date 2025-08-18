const cds = require('@sap/cds');
const { getVazaoTotal, minutosDaOrdem, proximoSlotNaFila } = require('../shared/capacidade');

module.exports = async function (req) {
  const { ordemProducao_ID, aprovado, motivo } = req.data;
  if (!ordemProducao_ID || aprovado === undefined) {
    return req.error(400, 'Parâmetros obrigatórios: ordemProducao_ID, aprovado');
  }

  const tx = cds.transaction(req);
  const [ordemProducao] = await tx.run(
    SELECT.from('my.modulomm.OrdemProducao').where({ ID: ordemProducao_ID })
  );
  if (!ordemProducao) return req.error(404, 'Ordem não encontrada.');

  if (!aprovado) {
    await tx.run(
      UPDATE('my.modulomm.OrdemProducao')
        .set({ status: 'negado', motivo: motivo ?? 'Reprovado por FI' })
        .where({ ID: ordemProducao_ID })
    );
    req.info(200, 'Ordem reprovada.');
    return true;
  }

  // 🔒 (somente para APROVAR) Centro de Custo deve existir e estar aprovado
  if (!ordemProducao.centroCusto_ID_ID) {
    return req.error(400, 'Ordem sem centro de custo vinculado.');
  }
  const [centroCusto] = await tx.run(
    SELECT.from('my.modulomm.CentroCusto').where({ ID: ordemProducao.centroCusto_ID_ID })
  );
  if (!centroCusto) return req.error(400, 'Centro de Custo inexistente.');
  if (!centroCusto.aprovado) return req.error(400, 'Centro de Custo não aprovado.');

  // ✅ 1) Confirma MP suficiente agora (BOM * quantidade da OP)
  const componentes = await tx.run(
    SELECT.from('my.modulomm.ComposicaoProduto').where({ produto_ID_ID: ordemProducao.produto_ID_ID })
  );
  for (const composicao of componentes) {
    const { materiaPrima_ID_ID, quantidade: qtdPorUnidade } = composicao;
    const qtdTotal = qtdPorUnidade * ordemProducao.quantidade;

    const [estoqueMP] = await tx.run(
      SELECT.from('my.modulomm.EstoqueMateriaPrima').where({ materiaPrima_ID_ID })
    );
    const disp = estoqueMP?.quantidade || 0;
    if (disp < qtdTotal) {
      return req.error(400, 'Matéria-prima ainda não disponível. OP permanece aguardando.');
    }
  }

  // ✅ 2) Capacidade e duração
  const capacidade = await getVazaoTotal(tx, ordemProducao.produto_ID_ID);
  if (!capacidade.ok) return req.error(400, capacidade.reason || 'Capacidade indisponível.');

  const duracaoMin = minutosDaOrdem(ordemProducao.quantidade, capacidade.vazao);
  const inicio = await proximoSlotNaFila(tx);
  const fim = new Date(inicio.getTime() + duracaoMin * 60_000);

  await tx.run(
    UPDATE('my.modulomm.OrdemProducao').set({
      status: 'pendente',
      prazoMinutos: duracaoMin,
      inicioPrevisto: inicio,
      fimPrevisto: fim,
      motivo: null
    }).where({ ID: ordemProducao_ID })
  );

  req.info(200, `Aprovada. Início=${inicio.toISOString()}, Fim=${fim.toISOString()}, Duração=${duracaoMin} min.`);
  return true;
};
