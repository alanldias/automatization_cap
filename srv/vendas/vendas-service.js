const cds = require('@sap/cds');

module.exports = cds.service.impl(function () {
    const { Produtos, Carrinho, CarrinhoItem, Pedidos, PedidoItem } = this.entities;

    this.on('addToCart', async (req) => {
      const { usuario, produtoID, quantidade } = req.data;
      console.log("📥 Dados recebidos no addToCart:", { usuario, produtoID, quantidade });
  
      const produto = await SELECT.one.from(Produtos).where({ ID: produtoID });
      console.log("🔍 Produto encontrado:", produto);
  
      if (!produto) {
          console.log("❌ Produto não encontrado para ID:", produtoID);
          return req.error(404, 'Produto não encontrado');
      }
  
      let carrinho = await SELECT.one.from(Carrinho).where({ usuario });
      console.log("🛒 Carrinho encontrado:", carrinho);
  
      if (!carrinho) {
        console.log("➕ Nenhum carrinho encontrado, criando novo para usuário:", usuario);
        await INSERT.into(Carrinho).entries({ usuario });
        carrinho = await SELECT.one.from(Carrinho).where({ usuario }); // ✅ garante que ID vem do banco
        console.log("📦 Carrinho criado e recuperado:", carrinho);
        }
    
  
      console.log("✅ ID do carrinho a ser usado:", carrinho?.ID);
  
      const precoUnitario = produto.preco;
      const total = precoUnitario * quantidade;
      console.log("💰 Valores calculados:", { precoUnitario, total });
  
      const resultItem = await INSERT.into(CarrinhoItem).entries({
          carrinho_ID: carrinho.ID,
          produto_ID: produtoID,
          quantidade,
          precoUnitario,
          total
      });
      console.log("📦 Resultado do INSERT item:", resultItem);
  
      return `Produto ${produto.nome} adicionado ao carrinho de ${usuario}.`;
  });
  

    this.on('removeFromCart', async (req) => {
        const { itemID } = req.data;
        await DELETE.from(CarrinhoItem).where({ ID: itemID });
        return `Item removido do carrinho.`;
    });

    this.on('finalizarPedido', async (req) => {
        const { usuario } = req.data;
        console.log("📥 Dados recebidos no finalizarPedido:", { usuario });
    
        console.log("📋 Entidades disponíveis no serviço:", Object.keys(this.entities));
    
        const carrinhoEntity = this.entities.Carrinho;
        console.log("🔍 Entidade Carrinho usada:", carrinhoEntity?.name);
    
        // Buscar carrinho do usuário
        let carrinho;
        try {
            carrinho = await SELECT.one.from(carrinhoEntity).where({ usuario });
            console.log("🛒 Carrinho encontrado:", carrinho);
        } catch (err) {
            console.error("❌ Erro ao buscar carrinho:", err);
            throw err;
        }
    
        if (!carrinho) return req.error(404, 'Carrinho não encontrado');
    
        // Buscar itens do carrinho
        let itensCarrinho;
        try {
            itensCarrinho = await SELECT.from(this.entities.CarrinhoItem)
                .where({ carrinho_ID: carrinho.ID });
            console.log("📦 Itens do carrinho encontrados:", itensCarrinho);
        } catch (err) {
            console.error("❌ Erro ao buscar itens do carrinho:", err);
            throw err;
        }
    
        if (itensCarrinho.length === 0) return req.error(400, 'Carrinho vazio');
    
        // Buscar produtos da entidade base para calcular valores
        const { Produtos: ProdutosBase } = cds.entities('my.vendas');
        for (const item of itensCarrinho) {
            const produto = await SELECT.one.from(ProdutosBase).where({ ID: item.produto_ID });
            item.precoUnitario = produto.preco;
            item.total = produto.preco * item.quantidade;
        }
    
        const totalPedido = itensCarrinho.reduce((acc, item) => acc + Number(item.total), 0);
        console.log("💰 Total do pedido:", totalPedido);
    
        // Criar pedido com data atual
        const dataAgora = new Date().toISOString();
        await INSERT.into(this.entities.Pedidos).entries({
            usuario,
            dataPedido: dataAgora, // ✅ Força data/hora atual
            status: 'Pendente',
            total: totalPedido
        });
    
        // Buscar o último pedido criado para este usuário
        const pedido = await SELECT.one.from(this.entities.Pedidos)
            .where({ usuario })
            .orderBy({ dataPedido: 'desc' });
        console.log("🆕 Pedido criado:", pedido);
    
        // Criar itens do pedido
        for (const item of itensCarrinho) {
            await INSERT.into(this.entities.PedidoItem).entries({
                pedido_ID: pedido.ID,
                produto_ID: item.produto_ID,
                quantidade: item.quantidade,
                precoUnitario: item.precoUnitario,
                total: item.total
            });
        }
    
        // Limpar carrinho
        await DELETE.from(this.entities.CarrinhoItem).where({ carrinho_ID: carrinho.ID });
        console.log("🗑 Carrinho limpo para usuário:", usuario);
    
        return `Pedido ${pedido.ID} criado com sucesso! Total: R$ ${totalPedido}`;
    });
    
    this.on('realizarPagamento', async (req) => {
        const { pedidoID, formaPagamento } = req.data;
        console.log("💳 Realizando pagamento:", { pedidoID, formaPagamento });
    
        // Lista de formas válidas do enum TipoPagamento
        const formasValidas = ["PIX", "CARTAO_CREDITO", "CARTAO_DEBITO"];
    
        if (!pedidoID) {
            return req.error(400, 'ID do pedido é obrigatório');
        }
    
        if (!formaPagamento || !formasValidas.includes(formaPagamento)) {
            return req.error(400, `Forma de pagamento inválida. Valores permitidos: ${formasValidas.join(", ")}`);
        }
    
        const { Pedidos } = this.entities;
        const pedido = await SELECT.one.from(Pedidos).where({ ID: pedidoID });
        console.log("🔍 Pedido encontrado:", pedido);
    
        if (!pedido) {
            return req.error(404, 'Pedido não encontrado');
        }
    
        if (pedido.status === 'Pago') {
            return `O pedido ${pedidoID} já foi pago.`;
        }
    
        // Atualizar status e forma de pagamento
        await UPDATE(Pedidos)
            .set({ status: 'Pago', formaPagamento })
            .where({ ID: pedidoID });
    
        console.log("✅ Pagamento confirmado para o pedido:", pedidoID, "Forma:", formaPagamento);
    
        return `Pagamento realizado com sucesso para o pedido ${pedidoID} via ${formaPagamento}.`;
    });
    
    this.on('getTotalCarrinho', async req => {
        const { usuario }          = req.data
        const { Carrinho, CarrinhoItem } = this.entities
      
        // procura carrinho
        const carrinho = await SELECT.one.from(Carrinho).where({ usuario })
        if (!carrinho) return { value : "R$ 0,00" }
      
        // soma
        const { total } = await SELECT.one.from(CarrinhoItem)
              .columns`sum(total) as total`
              .where({ carrinho_ID: carrinho.ID })
      
        const valor = Number(total || 0).toLocaleString(
                       "pt-BR", { style:"currency", currency:"BRL" }) // "R$ 13.300,00"
      
        return { value : valor }          //  ←  sempre nesse formato
      })
                                                                                              
});
