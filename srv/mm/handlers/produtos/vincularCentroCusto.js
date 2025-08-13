const cds = require('@sap/cds');

module.exports = async function (req) {
  const { ordemProducao_ID, centroCusto_ID } = req.data;
  if (!ordemProducao_ID || !centroCusto_ID) {
    return req.error(400, 'Parâmetros obrigatórios: ordemProducao_ID, centroCusto_ID');
  }

  const tx = cds.transaction(req);

  // OP precisa existir e estar aguardando aprovação (fase de FI)
  const [op] = await tx.run(
    SELECT.from('my.modulomm.OrdemProducao').where({ ID: ordemProducao_ID })
  );
  if (!op) return req.error(404, 'Ordem de produção não encontrada.');
  if (op.status !== 'aguardando_aprovacao') {
    return req.error(400, `Não é possível vincular CC com status "${op.status}".`);
  }

  // Centro de Custo precisa existir (não exigimos aprovado aqui;
  // a action de APROVAÇÃO já exige cc.aprovado=true)
  const [cc] = await tx.run(
    SELECT.from('my.modulomm.CentroCusto').where({ ID: centroCusto_ID })
  );
  if (!cc) return req.error(404, 'Centro de Custo não encontrado.');

  await tx.run(
    UPDATE('my.modulomm.OrdemProducao')
      .set({ centroCusto_ID: { ID: centroCusto_ID } })
      .where({ ID: ordemProducao_ID })
  );

  req.info(200, `CC vinculado: ${cc.nome} (${centroCusto_ID}).`);
  return true;
};
