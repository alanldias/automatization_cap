module.exports = async function (req) {
    const { produto_ID } = req.data;
    const db = await cds.connect.to('db');
    const materia = await db.run(SELECT.one.from('ModuloMM.EstoqueMateriaPrima').where({ produto_ID }));
    return materia?.quantidade < 30;
  };