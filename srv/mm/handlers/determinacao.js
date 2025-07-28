const db = require('@sap/cds');

module.exports.verificarNecessidade = async (req) => {
  const { material_ID } = req.data;

  const [estoque] = await db.run(
    SELECT.from('ModuloMM.Estoque').where({ material_ID })
  );

  return estoque?.quantidade < 50;
};
