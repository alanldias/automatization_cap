// 🛒 Cria uma Requisição de Compra no banco, para uma matéria-prima e quantidade
const cds = require('@sap/cds');

module.exports = async function gerarRequisicaoCompra(tx, materiaPrima_ID, quantidade) {
  // 1️⃣ Executa o insert na tabela de Requisicoes
  await tx.run(
    INSERT.into('my.modulomm.RequisicaoCompra').entries({
      materiaPrima_ID: { ID: materiaPrima_ID }, 
      quantidade,
      status: 'aguardando_aprovacao',                    
    })
  );
};
