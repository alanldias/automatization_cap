using my.distribuicao as my from '../../db/distribuicao-Schema';

service distribuicaoServico {
    entity Entrega               as projection on my.Entrega;

    entity Veiculo               as projection on my.Veiculo;

    entity CentroDistribuicao    as projection on my.CentroDistribuicao;

    entity PedidosProntosEntrega as projection on my.PedidosProntosEntrega;

    entity OcorrenciasEntrega    as projection on my.OcorrenciasEntrega;


    type PedidoInput {
        pedidoID : UUID;
        cep      : String;
        numero   : String;
    };

    action rastrearEntrega(codigo : String)                                                 returns {
        success            : Boolean;
        message            : String;
        geometry           : my.Polyline;
        etapasRota         : LargeString;
        destinos           : LargeString;
        sequenciaRastreios : LargeString;
        statusEntrega      : String;
        horarioEntrega     : String; //  ← novo
        distanciaKm        : Integer;
    };

    action atualizarStatusPedidos(pedidos : many UUID, novoStatus : String)                 returns {
        success     : Boolean;
        message     : String;
        atualizados : Integer;
    };

    action confirmarEntregaOk(codigo : String)                                              returns {
        success        : Boolean;
        message        : String;
        horarioEntrega : String;
    };

    action reagendarEntrega(codigo : String)                                                returns {
        success  : Boolean;
        message  : String;
        pedidoID : UUID;
    };

    type TipoOcorrencia : String enum {
        PEDIDO_ERRADO;
        PEDIDO_QUEBRADO;
        CLIENTE_DESCONHECE;
        ENDERECO_INVALIDO;
        OUTROS;
    }

    action registrarOcorrencia(codigo : String, tipo : TipoOcorrencia, observacao : String) returns {
        success : Boolean;
        message : String;
    };

    action listarVeiculosDisponiveis(centroId : UUID)                                       returns many {
        ID                 : UUID;
        nome               : String;
        placa              : String;
        capacidade         : Integer;
        capacidadeAtual    : Integer;
        capacidadeRestante : Integer;
        status             : String;
    };

    action selecionarPedidosParaVeiculo(veiculoId : UUID, pedidos : many UUID)              returns {
        success            : Boolean;
        message            : String;
        selecionados       : Integer;
        rejeitados         : Integer;
        capacidadeRestante : Integer;
        falhas             : LargeString;
    };

    action despacharVeiculo(veiculoId : UUID)                                               returns {
        success      : Boolean;
        message      : String;
        geometry     : my.Polyline;
        steps        : LargeString;
        rastreios    : LargeString;
        totalPedidos : Integer;
    };

    action desalocarPedidos(veiculoId : UUID, pedidos : many UUID)                          returns {
        success            : Boolean;
        message            : String;
        removidos          : Integer;
        capacidadeRestante : Integer;
    };

    action encerrarRotaDoVeiculo(codigo : String)                                           returns {
        success : Boolean;
        message : String;
    };

}
