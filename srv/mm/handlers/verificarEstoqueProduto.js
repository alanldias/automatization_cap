module.exports = async function (req) {
    const { produto_ID } = req.data;
    const db = await cds.connect.to('db');
    const estoque = await db.run(SELECT.one.from('ModuloMM.EstoqueProduto').where({ produto_ID }));
    return estoque?.quantidade < 50;
  };