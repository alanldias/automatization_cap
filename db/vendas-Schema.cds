namespace my.vendas;
using {
    cuid,
    managed
} from '@sap/cds/common';

entity Pedidos : cuid, managed {
    key ID          : UUID;
        dataPedido  : Date;
        valorTotal  : Decimal(9, 2);
        items       : Composition of many ItensPedido on items.pedido = $self;
}

entity ItensPedido : cuid, managed {
    key ID          : UUID;
        pedido      : Association to Pedidos;
        produto     : String; 
        quantidade  : Integer;
}