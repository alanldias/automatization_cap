using my.distribuicao as my from '../../db/distribuicao-Schema';

service distribuicaoServico {
    entity Entrega            as projection on my.Entrega;

    entity Veiculo            as projection on my.Veiculo;

    entity CentroDistribuicao as projection on my.CentroDistribuicao;

    action realizarEntrega(pedidoID : UUID,
                           cepDestino : String,
                           numero : String) returns {
        success  : Boolean;
        message  : String;
        geometry : my.Polyline; // devolve imediatamente p/ UI5
    };

    action rastrearEntrega(codigo : String) returns {
        success       : Boolean;
        message       : String;
        geometry      : my.Polyline;
        steps         : LargeString;
        statusEntrega : String;
        horarioEntrega : String;     //  ← novo
        distanciaKm   : Integer;
    };

    action atualizarStatusEntrega(codigo : String, // rastreio
                                  novoStatus : String // deve estar na enum
    )                                       returns {
        success : Boolean;
        message : String;
        horarioEntrega : String;     // devolve quando virar Entregue
    };
}
