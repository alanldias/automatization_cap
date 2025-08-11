const cds = require('@sap/cds');
const { getVazaoTotal, minutosDaOrdem, proximoSlotNaFila } = require('../shared/capacidade');

module.exports = async function (req) {
  const { ordemProducao_ID, aprovado, motivo } = req.data;
  if (!ordemProducao_ID || aprovado === undefined) {
    return req.error(400, 'Parâmetros obrigatórios: ordemProducao_ID, aprovado');
  }

  const tx = cds.transaction(req);

  // 1) Carrega OP
  const [op] = await tx.run(
    SELECT.from('my.modulomm.OrdemProducao').where({ ID: ordemProducao_ID })
  );
  if (!op) return req.error(404, 'Ordem não encontrada.');

  // 2) Se reprovou → status negado + motivo
  if (!aprovado) {
    await tx.run(
      UPDATE('my.modulomm.OrdemProducao')
        .set({ status: 'negado', motivo: motivo ?? 'Reprovado por FI' })
        .where({ ID: ordemProducao_ID })
    );
    req.info(200, 'Ordem reprovada.');
    return true;
  }

  // 3) Capacidade e duração
  const cap = await getVazaoTotal(tx, op.produto_ID_ID);
  if (!cap.ok) {
    return req.error(400, cap.reason || 'Capacidade indisponível para este produto.');
  }
  const duracaoMin = minutosDaOrdem(op.quantidade, cap.vazao);

  // 4) Slot na fila (FIFO)
  const inicio = await proximoSlotNaFila(tx);
  const fim = new Date(inicio.getTime() + duracaoMin * 60_000);

  // 5) Atualiza OP para pendente com ETA
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
