const cds = require('@sap/cds');
const { getVazaoTotal, minutosDaOrdem, proximoSlotNaFila } = require('../shared/capacidade');

module.exports = async function (req) {
  const { ordemProducao_ID, aprovado, motivo } = req.data;
  if (!ordemProducao_ID || aprovado === undefined) {
    return req.error(400, 'Parâmetros obrigatórios: ordemProducao_ID, aprovado');
  }

  const tx = cds.transaction(req);
  const [op] = await tx.run(
    SELECT.from('my.modulomm.OrdemProducao').where({ ID: ordemProducao_ID })
  );
  if (!op) return req.error(404, 'Ordem não encontrada.');

  if(!op.centroCusto_ID_ID){
    return req.error(400, 'Ordem sem centro de custo vinculado.')
  }
  const [centroCusto] = await tx.run(
    SELECT.from('my.modulomm.CentroCusto').where({ ID: op.centroCusto_ID_ID })
  )
  if(!centroCusto) {
    return req.error(400, 'Centro de Custo inexistente.')
  }
  if(!centroCusto.aprovado){
    return req.error(400, 'Centro de Custo não aprovado.')
  }
  
  if (!aprovado) {
    await tx.run(
      UPDATE('my.modulomm.OrdemProducao')
        .set({ status: 'negado', motivo: motivo ?? 'Reprovado por FI' })
        .where({ ID: ordemProducao_ID })
    );
    req.info(200, 'Ordem reprovada.');
    return true;
  }

  // ✅ 1) Confirma MP suficiente agora (BOM * quantidade da OP)
  const componentes = await tx.run(
    SELECT.from('my.modulomm.ComposicaoProduto').where({ produto_ID_ID: op.produto_ID_ID })
  );
  for (const comp of componentes) {
    const { materiaPrima_ID_ID, quantidade: qtdPorUnidade } = comp;
    const qtdTotal = qtdPorUnidade * op.quantidade;

    const [est] = await tx.run(
      SELECT.from('my.modulomm.EstoqueMateriaPrima').where({ materiaPrima_ID_ID })
    );
    const disp = est?.quantidade || 0;
    if (disp < qtdTotal) {
      return req.error(400, 'Matéria-prima ainda não disponível. OP permanece aguardando.');
    }
  }

  // ✅ 2) Capacidade e duração
  const cap = await getVazaoTotal(tx, op.produto_ID_ID);
  if (!cap.ok) return req.error(400, cap.reason || 'Capacidade indisponível.');

  const duracaoMin = minutosDaOrdem(op.quantidade, cap.vazao);
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
