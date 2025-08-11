namespace my.modulomm;

using {
cuid,
managed
} from '@sap/cds/common';

type StatusOrdemProducao : String(20) enum{
    aguardando_aprovacao;
    pendente;
    em_producao;
    concluido;
    negado;
}

type StatusRequisicao : String(20) enum{
    pendente;
    aguardando_aprovacao;
    aprovada;
    rejeitada;
}

entity MateriaPrima : cuid, managed {
nome    : String(100);
tipo    : String(30);
unidade : String(10);
preco   : Decimal(10, 2); // Preço unitário da matéria-prima
}

entity Produto : cuid, managed {
nome         : String(100);
tipo         : String(30); // Ex: cadeira, mesa, armário
unidade      : String(10); // importante para unidade de saída
peso         : Decimal(10,2);
altura       : Decimal(10,2);
largura      : Decimal(10,2);
profundidade : Decimal(10,2);
precoCusto   : Decimal(10,2);
precoVenda   : Decimal(10,2);
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
status          : StatusRequisicao default 'pendente';
motivo          : String(255);
}

entity CentroCusto : cuid, managed {
nome     : String(100);
aprovado : Boolean default false;
}

entity Funcionario : cuid, managed {
nome           : String(100);
tipo           : String(30); // operador, supervisor, etc
ativo          : Boolean default true;
producaoPorDia : Integer; // capacidade de produção
}

entity OrdemProducao : cuid, managed {
produto_ID      : Association to Produto;
centroCusto_ID  : Association to CentroCusto;
quantidade      : Integer;
status          : StatusOrdemProducao default 'aguardando_aprovacao';
prazoMinutos    : Integer;
inicioPrevisto  : DateTime;
fimPrevisto     : DateTime;
motivo          : String(255);
}

entity TempoProducao : cuid, managed {
produto_ID   : Association to Produto;
tempoMinutos : Integer;
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

