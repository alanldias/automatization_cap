module.exports = async function (req) {
    const { nome } = req.data;
    const db = await cds.connect.to('db');
    const epi = await db.run(SELECT.one.from('ModuloMM.EstoqueEPI').where({ nome }));
    return epi?.quantidade < 10;
  };