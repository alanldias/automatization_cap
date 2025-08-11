const cds = require('@sap/cds');
const { getVazaoTotal, minutosDaOrdem } = require('./capacidade');

module.exports = async function (req) {
  const { produto_ID, quantidade } = req.data;
  if (!produto_ID || !quantidade || quantidade <= 0) {
    return req.error(400, 'Parâmetros obrigatórios: produto_ID, quantidade (>0)');
  }

  const tx = cds.transaction(req);
  const cap = await getVazaoTotal(tx, produto_ID);
  if (!cap.ok) {
    req.info(200, cap.reason || 'Capacidade indisponível.');
    return false;
  }

  const duracaoMin = minutosDaOrdem(quantidade, cap.vazao);
  req.info(200, `Capacidade OK. Ativos=${cap.ativos}, Tempo/un=${cap.tempoPorUnidadeMin}min, Vazão=${cap.vazao.toFixed(4)} un/min, Duração estimada=${duracaoMin} min.`);
  return true; // por enquanto a action retorna Boolean; detalhes vão no info
};
