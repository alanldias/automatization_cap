using my.modulomm as my from '../../db/mm-schema';

service MMService {
  // Entidades principais
  entity Produtos                  as projection on my.Produto;
  entity MateriasPrimas            as projection on my.MateriaPrima;
  entity EstoquesProdutos          as projection on my.EstoqueProduto;
  entity EstoquesMateriaPrima      as projection on my.EstoqueMateriaPrima;
  entity RequisicoesCompras        as projection on my.RequisicaoCompra;
  entity OrdensProducao            as projection on my.OrdemProducao;
  entity EPIs                      as projection on my.EPI;
  entity Insumos                   as projection on my.Insumo;
  entity EstoqueInsumos            as projection on my.EstoqueInsumo;
  entity HistoricoReposicaoInsumos as projection on my.HistoricoReposicaoInsumo;

  // ⚠️ Exposição temporária - usada internamente, pode ser removida futuramente
  entity ComposicaoProdutos        as projection on my.ComposicaoProduto;

// Ações futuras podem ser definidas aqui

@odata.action
action verificarNecessidadeProduto(produto_ID: UUID) returns Boolean;

@odata.action
action gerarOrdemProducao(produto_ID: UUID, quantidade: Integer) returns Boolean;

@odata.action
action verificarNecessidadeMateriaPrima(materiaPrima_ID: UUID) returns Boolean;

@odata.action
action gerarRequisicaoCompra(materiaPrima_ID: UUID, quantidade: Integer) returns Boolean;

@odata.action
action verificarReposicaoInsumos(insumo_ID: UUID) returns Boolean;

@odata.action
action gerarReposicaoInsumos(insumo_ID: UUID, quantidade: Integer) returns Boolean;

}
