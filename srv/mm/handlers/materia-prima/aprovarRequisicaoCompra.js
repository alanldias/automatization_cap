const cds = require('@sap/cds');

module.exports = async function (req) {
  const { requisicao_ID, aprovado, motivo } = req.data;
  if (!requisicao_ID || aprovado === undefined) {
    return req.error(400, 'Parâmetros obrigatórios: requisicao_ID, aprovado');
  }

  const tx = cds.transaction(req);

  // 🔍 Busca RC
  const [rc] = await tx.run(
    SELECT.from('my.modulomm.RequisicaoCompra').where({ ID: requisicao_ID })
  );
  if (!rc) return req.error(404, 'Requisição não encontrada.');

  // 🔒 Bloqueia aprovação se status não for pendente/aguardando_aprovacao
  if (!['aguardando_aprovacao', 'pendente'].includes(rc.status)) {
    return req.error(400, `Status atual ${rc.status} não permite aprovação.`);
  }

  if (!aprovado) {
    await tx.run(
      UPDATE('my.modulomm.RequisicaoCompra')
        .set({ status: 'rejeitada', motivo: motivo ?? 'Compra negada' })
        .where({ ID: requisicao_ID })
    );
    req.info(200, 'Compra negada.');
    return true;
  }

  // ✅ Aprovar + dar entrada no estoque (upsert)
  const mpID = rc.materiaPrima_ID_ID;
  const qtd = rc.quantidade;

  const linhas = await tx.run(
    UPDATE('my.modulomm.EstoqueMateriaPrima')
      .set({ quantidade: { '+=': qtd } })
      .where({ materiaPrima_ID_ID: mpID })
  );

  if (linhas === 0) {
    await tx.run(
      INSERT.into('my.modulomm.EstoqueMateriaPrima').entries({
        materiaPrima_ID_ID: mpID,
        quantidade: qtd
      })
    );
  }

  await tx.run(
    UPDATE('my.modulomm.RequisicaoCompra')
      .set({ status: 'aprovada', motivo: motivo ?? null })
      .where({ ID: requisicao_ID })
  );

  req.info(200, `Compra aprovada. MP ${mpID} +${qtd} un.`);
  return true;
};
