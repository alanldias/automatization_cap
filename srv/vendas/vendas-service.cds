using my.vendas as vendas from '../../db/vendas-Schema';

service VendasService {
    entity Clientes as projection on vendas.Clientes;
    entity Produtos      as projection on vendas.Produtos;
    entity Carrinho      as projection on vendas.Carrinho;
    entity CarrinhoItem as projection on vendas.CarrinhoItem {
        *,
        produto: redirected to Produtos // ✅ expõe associação produto
    };
    entity Pedidos       as projection on vendas.Pedidos;
     entity PedidoItem as projection on vendas.PedidoItem {
        *,
        produto: redirected to Produtos // ✅ para ver itens do pedido com imagens
    };

    action addToCart(usuario : String, produtoID : UUID, quantidade : Integer) returns String;
    action removeFromCart(itemID : UUID) returns String;
    action finalizarPedido(usuario : String) returns String;
    action realizarPagamento(pedidoID: UUID, formaPagamento: String) returns String;
    action calcularTotalCarrinho(usuario : String) returns String;
}
