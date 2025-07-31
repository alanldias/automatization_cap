const cds = require("@sap/cds");

module.exports = async function selecionarVeiculoEcd(estado) {
  try {
    const { Veiculo, CentroDistribuicao } = cds.entities;

    const cdsDoEstado = await SELECT.from(CentroDistribuicao).where({ estado });

    for (const cd of cdsDoEstado) {
      const veiculo = await SELECT.one.from(Veiculo)
        .where({ centro_ID: cd.ID, emUso: false, status: "Disponivel" })
        .orderBy("capacidade desc");

      if (veiculo) return { veiculo, cd };
    }

    return null;
  } catch (err) {
    console.error("❌ Erro ao selecionar veículo e CD:", err.message);
    throw err;
  }
};
