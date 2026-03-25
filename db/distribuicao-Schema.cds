namespace my.distribuicao;

using {
    cuid,
    managed
} from '@sap/cds/common';

type Polyline : LargeString;
type Json     : LargeString;


entity Entrega : cuid, managed {
    pedidoID          : UUID;
    clienteNome       : String;
    cepDestino        : String;
    cidadeDestino     : String;
    estadoDestino     : String;
    enderecoCompleto  : String;
    distanciaKm       : Integer;
    rotaGeometry      : Polyline;
    transportadora    : String;
    rastreio          : String; //  já serve de “código da entrega”
    horarioEntrega    : String;
     statusEntrega : String enum {
      CRIADA;
      COLETADO;
      EM_TRANSITO;
      SAIU_PARA_ENTREGA;
      ENTREGUE;
      FALHOU
    };
    comprovanteGerado : Boolean default false;
    dataEnvio         : Date;
    veiculo           : Association to Veiculo;
    centroDistribuicao: Association to CentroDistribuicao;
    etapasRota         : Json;
}

entity CentroDistribuicao : cuid {
    nome             : String;
    cidade           : String;
    estado           : String;
    endereco         : String;
    capacidadeMaxima : Integer;
    lat              : Decimal(9, 6); // ← latitude
    lon              : Decimal(9, 6); // ← longitude
    veiculos         : Association to many Veiculo
                           on veiculos.centro = $self;
}

entity Veiculo : cuid, managed {
    nome       : String;
    placa      : String;
    capacidade : Integer;
    emUso      : Boolean default false;
    status     : String enum {
        Disponivel;
        EmRota;
        Manutencao
    };

    centro     : Association to CentroDistribuicao;
}
