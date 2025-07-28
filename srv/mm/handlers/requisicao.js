const db = require('@sap/cds');

module.exports.gerarRequisicao = async (req) => {
  const { material_ID, quantidade } = req.data;

  await db.run(INSERT.into('ModuloMM.RequisicaoCompra').entries({
    material_ID: { ID: material_ID},
    quantidade, 
    status: 'pendente', 
    dataCriacao: new Date()
  }));

  return true;
};
