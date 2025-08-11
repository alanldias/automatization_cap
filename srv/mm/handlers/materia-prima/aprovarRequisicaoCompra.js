const cds = require('@sap/cds');

module.exports = async function (req) {
  const { requisicao_ID, aprovado, motivo } = req.data;
  if (!requisicao_ID || aprovado === undefined) {
    return req.error(400, 'Parâmetros obrigatórios: requisicao_ID, aprovado');
  }
  // Implementação real virá na Etapa 3 (atualizar status)
  req.info(200, 'Stub aprovarRequisicaoCompra executado (sem efeitos).');
  return true;
};
