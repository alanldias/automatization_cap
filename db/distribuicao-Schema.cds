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
      FALHOU;
      REAGENDAR;
      COM_PROBLEMAS;
    };
    comprovanteGerado : Boolean default false;
    dataEnvio         : Date;
    veiculo           : Association to Veiculo;
    centroDistribuicao: Association to CentroDistribuicao;
    etapasRota         : Json;
    destinos     : LargeString;
    sequenciaRastreios  : LargeString;
    descricaoProblema : String(80);
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
    capacidadeAtual: Integer;
    capacidade : Integer;
    emUso      : Boolean default false;
    status     : String enum {
        Disponivel;
        EmRota;
        Manutencao
    };

    centro     : Association to CentroDistribuicao;
}

entity PedidosProntosEntrega {
  key pedidoID   : UUID;
      clienteNome: String;
      cep        : String;
      numero     : String;
      cidade     : String;
      estado     : String;
      centro     : Association to CentroDistribuicao; // ← associação com o centro
      status     : String enum {
        PRONTO;
        SELECIONADO;
        ENVIADO;
        FINALIZADO;
        COM_PROBLEMAS;
      };
     descricaoProblema : String(80) default 'Sem problemas';
     lat              : Decimal(9, 6); // ← latitude
     lon              : Decimal(9, 6); // ← longitude

     veiculo          : Association to Veiculo; // ← novo: pedido “alocado” num caminhão

}

entity OcorrenciasEntrega {
  key ID           : UUID;
  pedido         : Association to PedidosProntosEntrega;   // ← sem FK explícito
  tipo             : String;        // ex: PEDIDO_ERRADO, ENDERECO_INVALIDO
  observacao       : String;
  dataOcorrencia   : DateTime;
  criadoPor        : String;
}





