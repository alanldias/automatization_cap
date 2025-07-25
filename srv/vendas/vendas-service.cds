using my.vendas as vendas from '../../db/vendas-Schema';

service VendasService {
    @readonly entity Pedidos as projection on vendas.Pedidos;
    @readonly entity ItensPedido as projection on vendas.ItensPedido;
}