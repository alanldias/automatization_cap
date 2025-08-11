const cds = require('@sap/cds');
const verificarMateriaPrima = require('../materia-prima/../materia-prima/verificarMateriaPrima');
const gerarRequisicaoCompra = require('../materia-prima/../materia-prima/gerarRequisicaoCompra');

module.exports = async function produzirCore (tx, { produto_ID, quantidade, req }) {
  // 1) BOM
  const componentes = await tx.run(
    SELECT.from('my.modulomm.ComposicaoProduto').where({ produto_ID_ID: produto_ID })
  );
  if (!componentes.length) {
    if (req) req.info(200, 'Produto sem composição cadastrada.');
    return { ok:false };
  }

  // 2) Verifica MP e gera RCs
  let temTudo = true;
  const faltas = [];
  for (const comp of componentes) {
    const { materiaPrima_ID_ID, quantidade: qtdPorUnidade } = comp;
    const qtdTotal = qtdPorUnidade * quantidade;

    const { ok, faltando } = await verificarMateriaPrima(tx, materiaPrima_ID_ID, qtdTotal);
    if (!ok) {
      temTudo = false;
      faltas.push({ materiaPrima_ID_ID, faltando });
      await gerarRequisicaoCompra(tx, materiaPrima_ID_ID, faltando);
      if (req) req.info(200, `Faltando ${faltando} un. da MP ${materiaPrima_ID_ID} → RC gerada.`);
    }
  }

  // 3) Sempre cria OP (para rastrear a demanda)
  const newID = cds.utils.uuid();
  await tx.run(
    INSERT.into('my.modulomm.OrdemProducao').entries({
      ID: newID,
      produto_ID: { ID: produto_ID },
      quantidade,
      status: 'aguardando_aprovacao',
      // sem agendar ainda; se faltar MP, deixamos um "rastro" no motivo
      motivo: temTudo ? null : 'Aguardando matéria-prima (RC gerada)'
    })
  );

  if (temTudo) {
    if (req) req.info(200, 'OP criada e aguardando aprovação.');
    return { ok:true, createdOrdemId: newID, needsMP:false };
  } else {
    if (req) req.info(200, 'OP criada (aguardando aprovação) e aguardando matéria-prima.');
    return { ok:true, createdOrdemId: newID, needsMP:true };
  }
};