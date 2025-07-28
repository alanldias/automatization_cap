const cds = require('@sap/cds');
const { verificarNecessidade } = require('./handlers/determinacao');
const { gerarRequisicao } = require('./handlers/requisicao');

module.exports = cds.service.impl(async function () {
  this.on('verificarNecessidade', verificarNecessidade);
  this.on('gerarRequisicaoCompra', gerarRequisicao);
});
