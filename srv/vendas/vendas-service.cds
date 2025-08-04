using my.vendas as vendas from '../../db/vendas-Schema';

service VendasService {
    entity Clientes as projection on vendas.Clientes;
    entity Pedidos as projection on vendas.Pedidos;
    @readonly entity ItensPedido as projection on vendas.ItensPedido;
}