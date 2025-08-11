const cds = require('@sap/cds');

module.exports = async function (req) {
  const { produto_ID, quantidade } = req.data;
  if (!produto_ID || !quantidade || quantidade <= 0) {
    return req.error(400, 'Parâmetros obrigatórios: produto_ID, quantidade (>0)');
  }
  // Implementação real virá na Etapa 3 (cálculo da vazão e duração)
  req.info(200, 'Stub verificarCapacidadeMaoDeObra executado (sem cálculo).');
  return true;
};
