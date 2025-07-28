const cds = require('@sap/cds');

module.exports = (srv) => {
  srv.on('verificarReposicaoInsumos', async (req) => {
    const { insumo_ID } = req.data;
    const db = await cds.connect.to('db');

    const [estoque] = await db.run(
      SELECT.from('ModuloMM.EstoqueInsumo').where({ insumo_ID })
    );

    if (!estoque) return false;

    const HOJE = new Date();
    const ultima = new Date(estoque.ultimaReposicao);
    const diffDias = Math.floor((HOJE - ultima) / (1000 * 60 * 60 * 24));

    return estoque.quantidade < 10 || diffDias >= 15;
  });

  srv.on('gerarReposicaoInsumos', async (req) => {
    const { insumo_ID, quantidade } = req.data;
    const db = await cds.connect.to('db');

    await db.run(
      INSERT.into('ModuloMM.HistoricoReposicaoInsumo').entries({
        insumo_ID,
        quantidade,
        dataReposicao: new Date()
      })
    );

    await db.run(
      UPDATE('ModuloMM.EstoqueInsumo').set({
        quantidade,
        ultimaReposicao: new Date()
      }).where({ insumo_ID })
    );

    return true;
  });
};