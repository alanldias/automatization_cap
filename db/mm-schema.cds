namespace my.modulomm;

using {
  cuid,
  managed
} from '@sap/cds/common';

entity MateriaPrima : cuid, managed {
  nome    : String(100);
  tipo    : String(30);
  unidade : String(10);
  preco   : Decimal(10, 2);
}

entity Produto : cuid, managed {
  nome    : String(100);
  tipo    : String(30); // Ex: cadeira, mesa, armário
  preco   : Decimal(10, 2);
  unidade : String(10); // importante para unidade de saída
}

entity ComposicaoProduto : cuid, managed {
  produto_ID      : Association to Produto;
  materiaPrima_ID : Association to MateriaPrima;
  quantidade      : Integer;
}

entity EstoqueMateriaPrima : cuid, managed {
  materiaPrima_ID : Association to MateriaPrima;
  quantidade      : Integer;
}

entity EstoqueProduto : cuid, managed {
  produto_ID : Association to Produto;
  quantidade : Integer;
}

entity RequisicaoCompra : cuid, managed {
  materiaPrima_ID : Association to MateriaPrima;
  quantidade      : Integer;
  status          : String(20); // pendente, aprovada, rejeitada
  dataCriacao     : Date;
}

entity OrdemProducao : cuid, managed {
  produto_ID  : Association to Produto;
  quantidade  : Integer;
  dataCriacao : Date;
  status      : String(20); // pendente, em_producao, concluida
}

entity EPI : cuid, managed {
  nome       : String(100);
  tipo       : String(30); // Ex: Segurança, Proteção Auditiva etc.
  unidade    : String(10); // para controle de estoque (ex: un, par)
  quantidade : Integer;
}

entity Insumo : cuid, managed {
  nome    : String(100);
  tipo    : String(30); // Ex: "café", "água"
  unidade : String(10); // Ex: "L", "kg", "pct"
}

entity EstoqueInsumo : cuid, managed {
  insumo_ID       : Association to Insumo;
  quantidade      : Integer;
  ultimaReposicao : Date;
}

entity HistoricoReposicaoInsumo : cuid, managed {
  insumo_ID     : Association to Insumo;
  quantidade    : Integer;
  dataReposicao : Date;
}
