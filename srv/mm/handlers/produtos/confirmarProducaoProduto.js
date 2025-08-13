const cds = require('@sap/cds');

module.exports = async function (req) {

  const { ordemProducao_ID } = req.data;
  const tx = cds.transaction(req);

  /* 1️⃣ Busca ordem de produção */
  const [ordem] = await tx.run(
    SELECT.from('my.modulomm.OrdemProducao').where({ ID: ordemProducao_ID })
  );

  if (!ordem) return req.error(404, 'Ordem de produção não encontrada.');

  // 🔒 Só permite confirmar quando pendente ou em_producao
  if (!['pendente', 'em_producao'].includes(ordem.status)){
    if (ordem.status === 'concluido') return req.error(400, 'Produção já concluída.')
    if (ordem.status === 'aguardando_aprovacao') return req.error(400, 'OP aguardando aprovação. Não é possível confirmar.')
    if (ordem.status === 'negado') return req.error(400, 'OP negada. Não é possível confirmar.')  
      
    return req.error(400, `Status "${ordem.status}" não permite confirmação.`)
  }

  const { produto_ID_ID, quantidade } = ordem;

  /* 2️⃣ BOM do produto */
  const componentes = await tx.run(
    SELECT.from('my.modulomm.ComposicaoProduto').where({ produto_ID: produto_ID_ID })
  );

  if (!componentes.length)
    return req.error(400, 'Produto sem composição cadastrada.');

  /* 3️⃣ Agrupa e soma quantidades de cada matéria-prima */
  const mapaMaterias = {};

  for (const comp of componentes) {
    const { materiaPrima_ID_ID, quantidade: qtdPorUnidade, ID: compID } = comp;
    const qtdTotal = qtdPorUnidade * quantidade;

    if (!mapaMaterias[materiaPrima_ID_ID]) {
      mapaMaterias[materiaPrima_ID_ID] = {
        total: 0,
        linhas: new Set()
      };
    } 

    if (!mapaMaterias[materiaPrima_ID_ID].linhas.has(compID)) {
      mapaMaterias[materiaPrima_ID_ID].total += qtdTotal;
      mapaMaterias[materiaPrima_ID_ID].linhas.add(compID);
    }
  }

  /* 4️⃣ Atualiza os estoques de matéria-prima */
  for (const materiaPrima_ID_ID in mapaMaterias) {
    await tx.run(
      UPDATE('my.modulomm.EstoqueMateriaPrima')
        .set({ quantidade: { '-=': mapaMaterias[materiaPrima_ID_ID].total } })
        .where({ materiaPrima_ID_ID })
    );
  }

  /* 5️⃣ Upsert do estoque do produto */
  const linhasAfetadas = await tx.run(
    UPDATE('my.modulomm.EstoqueProduto')
      .set({ quantidade: { '+=': quantidade } })   // soma atomicamente
      .where({ produto_ID_ID })
  );

  /* Se não havia estoque para este produto ainda, cria agora */
  if (linhasAfetadas === 0) {
    await tx.run(
      INSERT.into('my.modulomm.EstoqueProduto')
        .entries({ produto_ID_ID, quantidade })
    );
  }

  /* 6️⃣ Atualiza status da ordem → concluído */
  await tx.run(
    UPDATE('my.modulomm.OrdemProducao')
      .set({ status: 'concluido' })
      .where({ ID: ordemProducao_ID })
  );

  return true; // sucesso
};
