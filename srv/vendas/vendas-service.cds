using my.vendas as vendas from '../../db/vendas-Schema';

service VendasService {

  entity Clientes     as projection on vendas.Clientes;
  entity Produtos     as projection on vendas.Produtos;
  entity Carrinho     as projection on vendas.Carrinho;
  entity CarrinhoItem as projection on vendas.CarrinhoItem {
    *,
    produto : redirected to Produtos
  };

  // Projeção de Pedidos com alias para a composição original 'itens'
  entity Pedidos as projection on vendas.Pedidos {
    *,                                       // todos os campos de Pedidos
    itens as ItensPedido : redirected to PedidoItem
  };

  entity PedidoItem as projection on vendas.PedidoItem {
    *,
    produto : redirected to Produtos
  };

  action addToCart           (usuario : String, produtoID : UUID, quantidade : Integer, esperaProducao: Boolean) returns String;
  action removeFromCart      (itemID  : UUID)                                         returns String;
  action finalizarPedido     (usuario : String, esperaProducao : Boolean)                                       returns String;
  action realizarPagamento   (pedidoID: UUID, formaPagamento: String)                 returns String;
  action calcularTotalCarrinho(usuario : String)                                    returns String;
  action cancelarPedido      (pedidoID : UUID)                                       returns String;
}
