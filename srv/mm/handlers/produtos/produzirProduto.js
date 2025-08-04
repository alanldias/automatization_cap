const cds = require('@sap/cds');
const verificarMateriaPrima = require('../materia-prima/verificarMateriaPrima');
const gerarRequisicaoCompra = require('../materia-prima/gerarRequisicaoCompra');

module.exports = async function (req) {
  console.log("1")
  const { produto_ID, quantidade } = req.data;
  const tx = cds.transaction(req);

  const componentes = await tx.run(
    SELECT.from('my.modulomm.ComposicaoProduto').where({ produto_ID_ID: produto_ID })
  );
  console.log("componentes", componentes)


  if (!componentes.length)
    return req.error(400, 'Produto sem composição cadastrada.');

  const requisicoes = [];
  let temTudo = true;

  // Verifica se há estoque de cada matéria-prima
  for (const comp of componentes) {
    const { materiaPrima_ID_ID, quantidade: qtdPorUnidade } = comp;
    const qtdTotalNecessaria = qtdPorUnidade * quantidade;

    const { ok, faltando } = await verificarMateriaPrima(tx, materiaPrima_ID_ID, qtdTotalNecessaria);

    if (!ok) {
      temTudo = false;

      // Gera requisição e armazena no array para retorno
      await gerarRequisicaoCompra(tx, materiaPrima_ID_ID, faltando);

      requisicoes.push({
        materiaPrima_ID: materiaPrima_ID_ID,
        quantidade: faltando
      });

      req.info(200, `Faltando ${faltando} un. da matéria-prima ${materiaPrima_ID_ID} → requisição gerada.`);
    }
  }

  if (temTudo) {
    // Cria a ordem de produção normalmente
    await tx.run(
      INSERT.into('my.modulomm.OrdemProducao').entries({
        produto_ID: { ID: produto_ID },
        quantidade,
        dataCriacao: new Date(),
        status: 'pendente'
      })
    );
  }

  // Retorna um relatório do que aconteceu
  return {
    produto_ID,
    quantidadeParaProduzir: temTudo ? quantidade : 0,
    status: temTudo ? 'Em produção' : 'Aguardando matéria prima',
    requisicoesGeradas: requisicoes
  };
};
