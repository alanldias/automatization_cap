const cds = require('@sap/cds');

// Esqueleto da v1 (Etapa 1)
const produzirProduto = require('./handlers/produtos/produzirProduto');
const confirmarProducaoProduto = require('./handlers/produtos/confirmarProducaoProduto');
const verificarEstoqueProduto = require('./handlers/produtos/verificarEstoqueProduto');

// Novo esqueleto para v2 (Etapa 2)
const aprovarOrdemProducao = require('./handlers/produtos/aprovarOrdemProducao');
const aprovarRequisicaoCompra = require('./handlers/materia-prima/aprovarRequisicaoCompra');
const verificarCapacidadeMaoDeObra = require('./handlers/shared/verificarCapacidadeMaoDeObra');
const vincularCentroCusto = require('./handlers/produtos/vincularCentroCusto');

module.exports = cds.service.impl(async function () {
  // Actions da v1 (Etapa 1)
  this.on('produzirProduto', produzirProduto);
  this.on('confirmarProducaoProduto', confirmarProducaoProduto);
  this.on('verificarEstoqueProduto', verificarEstoqueProduto);

  // Novas actions para v2 (Etapa 2)
  this.on('aprovarOrdemProducao', aprovarOrdemProducao);
  this.on('aprovarRequisicaoCompra', aprovarRequisicaoCompra);
  this.on('verificarCapacidadeMaoDeObra', verificarCapacidadeMaoDeObra);
  this.on('vincularCentroCusto', vincularCentroCusto);
});
