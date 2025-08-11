const cds = require('@sap/cds');

async function getVazaoTotal(tx, produto_ID) {
  const tempo = await tx.run(
    SELECT.one.from('my.modulomm.TempoProducao')
      .columns('tempoMinutos')
      .where({ produto_ID_ID: produto_ID })
  );
  const tempoMin = tempo?.tempoMinutos;
  if (!tempoMin || tempoMin <= 0) return { ok:false, reason:'Sem tempo de produção cadastrado.' };

  const [row] = await tx.run(
    SELECT.from('my.modulomm.Funcionario')
      .columns`count(*) as ativos`
      .where({ ativo: true })
  );
  const ativos = Number(row?.ativos || 0);
  if (ativos <= 0) return { ok:false, reason:'Nenhum funcionário ativo.' };

  const vazao = ativos / tempoMin; // unid/min
  return { ok:true, vazao, tempoPorUnidadeMin: tempoMin, ativos };
}

function minutosDaOrdem(qtd, vazao) {
  return Math.max(1, Math.ceil(Number(qtd) / Number(vazao)));
}

async function proximoSlotNaFila(tx, agora = new Date()) {
  const [last] = await tx.run(
    SELECT.from('my.modulomm.OrdemProducao')
      .columns`max(fimPrevisto) as ultimoFim`
      .where({ status: ['pendente','em_producao'] })
  );
  const ultimoFim = last?.ultimoFim ? new Date(last.ultimoFim) : null;
  return (ultimoFim && ultimoFim > agora) ? ultimoFim : agora;
}

module.exports = { getVazaoTotal, minutosDaOrdem, proximoSlotNaFila };
