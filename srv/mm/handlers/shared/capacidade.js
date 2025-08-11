// srv/handlers/shared/capacidade.js
const cds = require('@sap/cds');

/**
 * Calcula a vazão total (unid/min) para um produto:
 *  vazao = funcionarios_ativos / tempoPorUnidadeMin
 */
async function getVazaoTotal(tx, produto_ID) {
  // Tempo por unidade do produto
  const tempo = await tx.run(
    SELECT.one.from('my.modulomm.TempoProducao')
      .columns('tempoMinutos')
      .where({ produto_ID_ID: produto_ID })
  );
  const tempoMin = tempo?.tempoMinutos;
  if (!tempoMin || tempoMin <= 0) {
    return { ok: false, reason: 'Sem tempo de produção cadastrado para o produto.' };
  }

  // Funcionários ativos
  const [row] = await tx.run(
    SELECT.from('my.modulomm.Funcionario')
      .columns`count(*) as ativos`
      .where({ ativo: true })
  );
  const ativos = Number(row?.ativos || 0);
  if (ativos <= 0) {
    return { ok: false, reason: 'Nenhum funcionário ativo.' };
  }

  const vazao = ativos / tempoMin; // unid/min
  return { ok: true, vazao, tempoPorUnidadeMin: tempoMin, ativos };
}

/** Duração em minutos = ceil(qtd / vazao). Nunca < 1. */
function minutosDaOrdem(quantidade, vazao) {
  return Math.max(1, Math.ceil(Number(quantidade) / Number(vazao)));
}

/**
 * Âncora para a próxima OP: agora ou o maior fimPrevisto (o que for maior).
 * Considera ordens 'pendente' e 'em_producao' (fila).
 */
async function proximoSlotNaFila(tx, agora = new Date()) {
  const [last] = await tx.run(
    SELECT.from('my.modulomm.OrdemProducao')
      .columns`max(fimPrevisto) as ultimoFim`
      .where({ status: ['pendente', 'em_producao'] })
  );
  const ultimoFim = last?.ultimoFim ? new Date(last.ultimoFim) : null;
  if (ultimoFim && ultimoFim > agora) return ultimoFim;
  return agora;
}

module.exports = { getVazaoTotal, minutosDaOrdem, proximoSlotNaFila };
