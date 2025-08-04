// 🔍 Verifica se há matéria-prima suficiente no estoque
const cds = require('@sap/cds');

module.exports = async function verificarMateriaPrima(tx, materiaPrima_ID, qtdNecessaria) {

  // 1️⃣ Consulta o estoque atual da matéria-prima
  const [estoque] = await tx.run(
    SELECT.from('my.modulomm.EstoqueMateriaPrima')
          .where({ materiaPrima_ID_ID: materiaPrima_ID })
  );

  // 2️⃣ Se não houver registro, considera 0
  const disponivel = estoque ? estoque.quantidade : 0;

  // 3️⃣ Calcula quanto está faltando (0 se tiver o suficiente)
  const faltando = Math.max(qtdNecessaria - disponivel, 0);

  // 4️⃣ Retorna se está ok ou não, junto com a quantidade faltante
  return {
    ok: faltando === 0,
    faltando
  };
};
