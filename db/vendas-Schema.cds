namespace my.vendas;

using { cuid, managed } from '@sap/cds/common';

type TipoEndereco : String enum {
    COBRANCA;
    ENTREGA;
}
type TipoPedido    : String enum { 
    PENDENTE; 
    PAGO; 
    CANCELADO;
    ENTREGUE; }
@odata.draft.enabled
entity Clientes : cuid, managed {
    key ID          : UUID;
        nome        : String(100);
        email       : String;
        telefone    : String;
        enderecos   : Composition of many Enderecos on enderecos.cliente = $self;
}

entity Enderecos : cuid {
    key ID          : UUID;
        cliente     : Association to Clientes;
        tipo        : TipoEndereco;
        logradouro  : String;
        numero      : String;
        bairro      : String;
        cidade      : String;
        estado      : String(2);
        cep         : String(8);
}

entity Produtos {
    key ID          : UUID @default :uuid;
    nome            : String(100);
    descricao       : String(255);
    preco           : Decimal(10,2);
    estoque         : Integer;
    imagem          : String(255);
    createdAt       : Timestamp @default :now;
}
 
entity Carrinho {
    key ID          : UUID @default :uuid;
    usuario         : String(50);
    createdAt       : Timestamp @default :now;
    items           : Composition of many CarrinhoItem on items.carrinho = $self;
}

entity CarrinhoItem {
    key ID              : UUID @default :uuid;
    carrinho            : Association to Carrinho;
    produto             : Association to Produtos;
    quantidade          : Integer;
    precoUnitario       : Decimal(10,2);
    total               : Decimal(10,2);
}

entity Pedidos {
    key ID          : UUID @default :uuid;
    usuario         : String(50);
    dataPedido      : Timestamp @default :now;
    status            : TipoPedido; 
    formaPagamento  : TipoPagamento; 
    total           : Decimal(10,2);
    itens           : Composition of many PedidoItem on itens.pedido = $self;
}
 
entity PedidoItem {
    key ID          : UUID @default :uuid;
    pedido          : Association to Pedidos;
    produto         : Association to Produtos;
    quantidade      : Integer;
    precoUnitario   : Decimal(10,2);
    total           : Decimal(10,2);
}
// ✅ Novo tipo para formas de pagamento
type TipoPagamento : String enum {
    PIX;
    CARTAO_CREDITO;
    CARTAO_DEBITO;
}