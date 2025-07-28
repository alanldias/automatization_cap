module.exports = async function (req) {
    const { produto_ID, quantidade } = req.data;
    const db = await cds.connect.to('db');
  
    const estoqueMateria = await db.run(SELECT.one.from('ModuloMM.EstoqueMateriaPrima').where({ produto_ID }));
    if (!estoqueMateria || estoqueMateria.quantidade < quantidade) {
      return req.error(400, 'Matéria-prima insuficiente.');
    }
  
    await db.run(UPDATE('ModuloMM.EstoqueMateriaPrima')
      .where({ produto_ID })
      .set({ quantidade: { '-=': quantidade } }));
  
    await db.run(UPDATE('ModuloMM.EstoqueProduto')
      .where({ produto_ID })
      .set({ quantidade: { '+=': quantidade } }));
  
    await db.run(INSERT.into('ModuloMM.OrdemProducao').entries({
      produto_ID,
      quantidade,
      status: 'concluida',
      dataCriacao: new Date()
    }));
  
    return true;
  };