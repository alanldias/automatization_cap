const cds = require('@sap/cds');

const produzirProduto = require('./handlers/produtos/produzirProduto');
const confirmarProducaoProduto = require('./handlers/produtos/confirmarProducaoProduto');
const verificarEstoqueProduto = require('./handlers/produtos/verificarEstoqueProduto');

module.exports = cds.service.impl(async function () {
  this.on('produzirProduto', produzirProduto);
  this.on('confirmarProducaoProduto', confirmarProducaoProduto);
  this.on('verificarEstoqueProduto', verificarEstoqueProduto);
});
