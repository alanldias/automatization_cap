const cds = require('@sap/cds');

module.exports = async function selecionarVeiculoEcd(estado) {
  const { Veiculo, CentroDistribuicao } = cds.entities;

  const cdsDoEstado = await SELECT.from(CentroDistribuicao).where({ estado });

  for (const cd of cdsDoEstado) {
    const veiculo = await SELECT.one.from(Veiculo)
      .where({ centro_ID: cd.ID, emUso: false, status: "Disponivel" })
      .orderBy("capacidade desc");

    if (veiculo) return { veiculo, cd };
  }

  return null;
};
