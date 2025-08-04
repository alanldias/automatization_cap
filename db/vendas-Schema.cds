// =================================================================
// Schema para o Módulo de Vendas
// Namespace: my.vendas
// =================================================================
namespace my.vendas;

using { cuid, managed } from '@sap/cds/common';

// Importa a entidade 'Produto' do seu módulo de manufatura/produtos.
using { my.modulomm.Produto } from './mm-schema';

//========================================
// Tipos Reutilizáveis (Enums)
//========================================

// Define os possíveis status de um pedido. O status 'PRONTO_PARA_ENTREGA'
// será o gatilho para o seu Módulo de Distribuição.
type StatusPedido : String enum {
    CRIADO;
    AGUARDANDO_PAGAMENTO;
    PAGO;
    CANCELADO;
    EM_PROCESSAMENTO;
    PRONTO_PARA_ENTREGA; // Gatilho para o Módulo de Distribuição
    CONCLUIDO;
}

type TipoEndereco : String enum {
    COBRANCA;
    ENTREGA;
}

//========================================
// Entidades Principais
//========================================

/**
 * Entidade para armazenar os dados dos clientes.
 * Cada cliente pode ter múltiplos endereços.
 */
 @odata.draft.enabled
entity Clientes : cuid, managed {
    key ID          : UUID;
        nome        : String(100) @title: 'Nome';
        email       : String @title: 'Email';
        telefone    : String @title: 'Telefone';
        // Um cliente "possui" seus endereços.
        enderecos   : Composition of many Enderecos on enderecos.cliente = $self;
}

/**
 * Endereços associados a um cliente.
 */
 @title: 'Endereço'
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

/**
 * A entidade central do módulo de vendas.
 * Orquestra todos os dados relacionados a uma transação.
 */
entity Pedidos : cuid, managed {
    key ID                  : UUID;
        cliente             : Association to Clientes;
        enderecoEntrega     : Association to Enderecos; // Endereço específico para este pedido
        dataPedido          : Timestamp default $now;
        status              : StatusPedido default 'CRIADO';
        
        // Campos Financeiros
        valorFrete          : Decimal(10, 2) default 0.00;
        valorDesconto       : Decimal(10, 2) default 0.00;
    
    // O subtotal é calculado a partir da soma dos itens.
    // É 'virtual' para ser calculado em tempo de execução, garantindo consistência.
    virtual subTotal        : Decimal(10, 2);
    // O valor final considera frete e descontos.
    virtual valorTotal      : Decimal(10, 2);
        
        // Um pedido é composto por seus itens.
        items               : Composition of many ItensPedido on items.pedido = $self;
        // Um pedido pode ter pagamentos associados.
        pagamentos          : Composition of many Pagamentos on pagamentos.pedido = $self;
}

/**
 * Itens que compõem um Pedido.
 * Cada item se refere a um produto do seu módulo de manufatura.
 */
entity ItensPedido : cuid {
    key ID                  : UUID;
        pedido              : Association to Pedidos;
    // Associação com a entidade do Módulo de Produtos ('my.modulomm')
        produto             : Association to Produto; 
        quantidade          : Integer;
    // 'Congela' o preço no momento da venda para fins históricos e de cálculo.
        precoUnitario       : Decimal(10, 2);
    // O valor total do item (qtd * preço) pode ser virtual.
    virtual valorItem       : Decimal(10, 2);
}

/**
 * Registra as transações de pagamento de um pedido.
 */
entity Pagamentos : cuid, managed {
    key ID                  : UUID;
        pedido              : Association to Pedidos;
        metodo              : String enum { PIX; CARTAO_CREDITO; BOLETO; };
        valor               : Decimal(10, 2);
        statusPagamento     : String enum { PENDENTE; APROVADO; RECUSADO; };
        idTransacaoGateway  : String; 
}
