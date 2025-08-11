const cds = require('@sap/cds');
const produzirCore = require('../shared/produzirCore');
const { getVazaoTotal, minutosDaOrdem, proximoSlotNaFila } = require('../shared/capacidade');


module.exports = async function (req) {
  const { produto_ID, quantidadeDesejada } = req.data;
  const tx = cds.transaction(req);

  const [estoque] = await tx.run(
    SELECT.from('my.modulomm.EstoqueProduto').where({ produto_ID_ID: produto_ID })
  );
  const estoqueAtual = estoque?.quantidade || 0;
  const saldoPosVenda = estoqueAtual - quantidadeDesejada;

  if (estoqueAtual < quantidadeDesejada) {
    const { ok, createdOrdemId, needsMP } = await produzirCore(tx, {
      produto_ID,
      quantidade: quantidadeDesejada,
      req
    });

    let eta = null;
    let mensagem;
    if (!needsMP) {
      const cap = await getVazaoTotal(tx, produto_ID);
      if (cap.ok) {
        const duracao = minutosDaOrdem(quantidadeDesejada, cap.vazao);
        const inicio = await proximoSlotNaFila(tx);
        eta = new Date(inicio.getTime() + duracao * 60_000);
        mensagem = `Estoque insuficiente. OP ${createdOrdemId} aberta (aguardando aprovação). ETA preliminar: ${eta.toISOString()}.`;
      } else {
        mensagem = `Estoque insuficiente. OP ${createdOrdemId} aberta (aguardando aprovação). Capacidade indisponível para estimar ETA preliminar.`;
      }
    } else {
      mensagem = `Estoque insuficiente. OP ${createdOrdemId} aberta (aguardando aprovação). Aguardando matéria-prima (RCs geradas).`;
    }

    return {
      ok: false,
      mensagem,
      ordemProducao_ID: createdOrdemId || null,
      etaPreliminar: eta
    };
  }

  // ... restante (baixa e preventiva via produzirCore) permanece igual ...
  await tx.run(
    UPDATE('my.modulomm.EstoqueProduto')
      .set({ quantidade: { '-=': quantidadeDesejada } })
      .where({ produto_ID_ID: produto_ID })
  );

  if (saldoPosVenda < 10) {
    const existe = await tx.run(
      SELECT.one.from('my.modulomm.OrdemProducao').where({
        produto_ID_ID: produto_ID,
        status: ['aguardando_aprovacao','pendente','em_producao']
      })
    );
    if (!existe) {
      await produzirCore(tx, { produto_ID, quantidade: 10, req });
    }
  }

  return {
    ok: true,
    mensagem: 'Venda atendida a partir do estoque.',
    ordemProducao_ID: null,
    etaPreliminar: null
  };
};
