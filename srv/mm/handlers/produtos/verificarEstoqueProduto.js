const cds = require('@sap/cds');

module.exports = async function (req) {
    const { produto_ID, quantidadeDesejada } = req.data;
    const tx = cds.transaction(req);

    // 1️⃣ Consulta estoque atual
    const [estoque] = await tx.run(
        SELECT.from('my.modulomm.EstoqueProduto').where({ produto_ID_ID: produto_ID })
    );

    const estoqueAtual = estoque?.quantidade || 0;
    const saldoPosVenda = estoqueAtual - quantidadeDesejada;

    if (estoqueAtual < quantidadeDesejada) {
        // 2️⃣ Sem estoque suficiente → cria ordem
        req.info(200, 'Estoque insuficiente. Ordem de produção gerada.');
        await tx.run(
            INSERT.into('my.modulomm.OrdemProducao').entries({
                produto_ID: { ID: produto_ID },
                quantidade: quantidadeDesejada,
                dataCriacao: new Date(),
                status: 'pendente'
            })
        );
        return false;
    }

    // 3️⃣ Tem estoque → baixa quantidade da venda
    await tx.run(
        UPDATE('my.modulomm.EstoqueProduto')
            .set({ quantidade: { '-=': quantidadeDesejada } })
            .where({ produto_ID_ID: produto_ID })
    );

    // 4️⃣ Se saldo futuro < 30 → verificar se já existe ordem em aberto
    if (saldoPosVenda < 30) {
        const ordensPendentes = await tx.run(
            SELECT.one.from('my.modulomm.OrdemProducao').where({
                produto_ID_ID: produto_ID,
                status: ['pendente', 'em_producao']
            })
        );

        if (!ordensPendentes) {
            req.info(200, 'Produção preventiva iniciada após venda.');
            await tx.run(
                INSERT.into('my.modulomm.OrdemProducao').entries({
                    produto_ID: { ID: produto_ID },
                    quantidade: 50,
                    dataCriacao: new Date(),
                    status: 'pendente'
                })
            );
        } else {
            req.info(200, 'Produção preventiva já em andamento. Nenhuma nova ordem criada.');
        }
    }


    return true; // Estoque baixado com sucesso
};
