using my.modulomm as my from '../../db/mm-schema';

service MMService @(path: '/odata/v4/mm') {
  entity Produtos                  as projection on my.Produto;
  entity MateriasPrimas            as projection on my.MateriaPrima;
  entity EstoquesProdutos          as projection on my.EstoqueProduto;
  entity EstoquesMateriaPrima      as projection on my.EstoqueMateriaPrima;
  entity RequisicoesCompras        as projection on my.RequisicaoCompra;

  entity OrdensProducao            as
    projection on my.OrdemProducao {
      *,
      produto_ID.nome as produto_nome
    };

  entity EPIs                      as projection on my.EPI;
  entity Insumos                   as projection on my.Insumo;
  entity EstoqueInsumos            as projection on my.EstoqueInsumo;
  entity HistoricoReposicaoInsumos as projection on my.HistoricoReposicaoInsumo;
  entity CentroCusto               as projection on my.CentroCusto;

  // ⚠️ Exposição temporária
  entity ComposicaoProdutos        as projection on my.ComposicaoProduto;

  // ✅ Ações da v1 (Etapa 1)
  action gerarRequisicaoCompra(materiaPrima_ID: UUID, quantidade: Integer)               returns Boolean;
  action verificarReposicaoInsumos(insumo_ID: UUID)                                      returns Boolean;
  action gerarReposicaoInsumos(insumo_ID: UUID, quantidade: Integer)                     returns Boolean;

  action produzirProduto(produto_ID: UUID, quantidade: Integer)                          returns Boolean;
  action confirmarProducaoProduto(ordemProducao_ID: UUID)                                returns Boolean;

  type VerificarEstoqueProdutoResult : {
    ok               : Boolean;
    mensagem         : String;
    ordemProducao_ID : UUID;
    etaPreliminar    : DateTime;
  }

  action verificarEstoqueProduto(produto_ID: UUID, quantidadeDesejada: Integer)          returns VerificarEstoqueProdutoResult;

  // ✅ Novas ações para v2 (Etapa 2)
  action aprovarOrdemProducao(ordemProducao_ID: UUID, aprovado: Boolean, motivo: String) returns Boolean;
  action aprovarRequisicaoCompra(requisicao_ID: UUID, aprovado: Boolean, motivo: String) returns Boolean;
  action verificarCapacidadeMaoDeObra(produto_ID: UUID, quantidade: Integer)             returns Boolean;
  action vincularCentroCusto(ordemProducao_ID: UUID, centroCusto_ID: UUID)               returns Boolean;
}
