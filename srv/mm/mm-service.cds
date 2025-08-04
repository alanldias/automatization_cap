using my.modulomm as my from '../../db/mm-schema';

service MMService @(path: '/odata/v4/mm') {
  // Entidades principais
  entity Produtos                  as projection on my.Produto;
  entity MateriasPrimas            as projection on my.MateriaPrima;
  entity EstoquesProdutos          as projection on my.EstoqueProduto;
  entity EstoquesMateriaPrima      as projection on my.EstoqueMateriaPrima;
  entity RequisicoesCompras        as projection on my.RequisicaoCompra;

  entity OrdensProducao            as
    projection on my.OrdemProducao {
      *, // inclui todos os campos
      produto_ID.nome as produto_nome // adiciona o nome do produto via associação
    }

  entity EPIs                      as projection on my.EPI;
  entity Insumos                   as projection on my.Insumo;
  entity EstoqueInsumos            as projection on my.EstoqueInsumo;
  entity HistoricoReposicaoInsumos as projection on my.HistoricoReposicaoInsumo;

  // ⚠️ Exposição temporária - usada internamente, pode ser removida futuramente
  entity ComposicaoProdutos        as projection on my.ComposicaoProduto;

  // Ações

  action gerarRequisicaoCompra(materiaPrima_ID : UUID, quantidade : Integer)      returns Boolean;

  action verificarReposicaoInsumos(insumo_ID : UUID)                              returns Boolean;

  action gerarReposicaoInsumos(insumo_ID : UUID, quantidade : Integer)            returns Boolean;

  // Produção

  action produzirProduto(produto_ID : UUID, quantidade : Integer)                 returns
  Boolean;

  action confirmarProducaoProduto(ordemProducao_ID : UUID)                        returns Boolean;

  action verificarEstoqueProduto(produto_ID : UUID, quantidadeDesejada : Integer) returns Boolean;
}
