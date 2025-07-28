const db = require('@sap/cds');

exports.getQuantidade = async (material_ID) => {
  const [result] = await db.run(SELECT.from('automatization.mm.Estoque').where({ material_ID }));
  return result?.quantidade || 0;
};
