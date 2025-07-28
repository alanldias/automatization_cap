namespace my.distribuicao;

using {
    cuid,
    managed
} from '@sap/cds/common';

entity Entrega : cuid, managed {
    pedidoID          : UUID;
    clienteNome       : String;
    cepDestino        : String;
    cidadeDestino     : String;
    estadoDestino     : String;
    enderecoCompleto  : String;
    distanciaKm       : Integer;
    transportadora    : String;
    rastreio          : String;
    horarioEntrega    : String enum {
        Manha;
        Tarde;
        Noite
    };
    statusEntrega     : String enum {
        Criada;
        Coletado;
        EmTransito;
        SaiuParaEntrega;
        Entregue;
        Falhou
    };
    comprovanteGerado : Boolean default false;
    dataEnvio         : Date;
    veiculo    : Association to Veiculo;
    centroDist : Association to CentroDistribuicao;
}

entity CentroDistribuicao : cuid {
    nome             : String;
    cidade           : String;
    estado           : String;
    endereco         : String;
    capacidadeMaxima : Integer;
    veiculos         : Association to many Veiculo on veiculos.centro = $self;
}

entity Veiculo : cuid, managed {
    nome       : String;
    placa      : String;
    capacidade : Integer;
    emUso      : Boolean default false;
    status     : String enum { Disponivel; EmRota; Manutencao };

    centro     : Association to CentroDistribuicao;
}

