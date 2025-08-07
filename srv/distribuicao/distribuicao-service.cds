using my.distribuicao as my from '../../db/distribuicao-Schema';

service distribuicaoServico {
    entity Entrega            as projection on my.Entrega;

    entity Veiculo            as projection on my.Veiculo;

    entity CentroDistribuicao as projection on my.CentroDistribuicao;

    entity PedidosProntosEntrega as projection on my.PedidosProntosEntrega;
    type PedidoInput {
        pedidoID : UUID;
        cep      : String;
        numero   : String;
    }

    action realizarEntrega(pedidos : many PedidoInput) returns {
        success  : Boolean;
        message  : String;
        geometry : my.Polyline;
        steps    : LargeString;
    };

    action rastrearEntrega(codigo : String)            returns {
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

    action atualizarStatusEntrega(codigo : String, // rastreio
                                  novoStatus : String) returns {
        success        : Boolean;
        message        : String;
        horarioEntrega : String; // devolve quando virar Entregue
        
    };

    action atualizarStatusPedidos(pedidos: many UUID, novoStatus: String) returns {
    success: Boolean;
    message: String;
    atualizados: Integer;
    
  };
  
}
