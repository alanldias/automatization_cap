const cds = require('@sap/cds');

module.exports = cds.service.impl(function () {
  const { Produtos, Carrinho, CarrinhoItem, Pedidos, PedidoItem } = this.entities;

  async function _getOrCreateCart (tx, usuario) {
    let cart = await tx.run(SELECT.one.from(Carrinho).where({ usuario }));
    if (!cart) {
      await tx.run(INSERT.into(Carrinho).entries({ usuario }));
      cart = await tx.run(SELECT.one.from(Carrinho).where({ usuario }));
    }
    return cart;
  }

  /** -------------------- ADD TO CART (não debita estoque) -------------------- */
  this.on('addToCart', async (req) => {
    const { usuario, produtoID, quantidade, esperaProducao } = req.data;
    const qtd = Math.max(1, Number(quantidade) || 1);
    const aguard = !!esperaProducao;

    const tx = cds.transaction(req);

    const produto = await tx.run(
      SELECT.one.from(Produtos).columns('ID','nome','preco','estoque').where({ ID: produtoID })
    );
    if (!produto) return req.reject(404, 'Produto não encontrado');

    const estoqueAtual = Number(produto.estoque || 0);
    if (qtd > estoqueAtual && !aguard) {
      return req.reject(409, `Quantidade indisponível. Disponíveis: ${estoqueAtual}.`);
    }

    const cart = await _getOrCreateCart(tx, usuario);

    const existente = await tx.run(
      SELECT.one.from(CarrinhoItem).where({ carrinho_ID: cart.ID, produto_ID: produtoID })
    );

    const unit = Number(produto.preco || 0);
    if (existente) {
      const novaQtd = Number(existente.quantidade || 0) + qtd;
      await tx.run(
        UPDATE(CarrinhoItem)
          .set({ quantidade: novaQtd, precoUnitario: unit, total: novaQtd * unit })
          .where({ ID: existente.ID })
      );
    } else {
      await tx.run(
        INSERT.into(CarrinhoItem).entries({
          carrinho_ID   : cart.ID,
          produto_ID    : produtoID,
          quantidade    : qtd,
          precoUnitario : unit,
          total         : unit * qtd
        })
      );
    }

    // 🚫 Não debita estoque aqui!
    return `Produto "${produto.nome}" adicionado (x${qtd}).`;
  });

  /** -------------------- REMOVER ITEM DO CARRINHO -------------------- */
  this.on('removeFromCart', async (req) => {
    const { itemID } = req.data;
    const tx = cds.transaction(req);

    const item = await tx.run(SELECT.one.from(CarrinhoItem).where({ ID: itemID }));
    if (!item) return req.reject(404, 'Item do carrinho não encontrado');

    await tx.run(DELETE.from(CarrinhoItem).where({ ID: itemID }));
    return 'Item removido do carrinho.';
  });

  /** -------------------- FINALIZAR PEDIDO (debita aqui, de forma atômica) -------------------- */
  this.on('finalizarPedido', async (req) => {
    const { usuario, esperaProducao } = req.data;
    const aguard = !!esperaProducao;
    const tx = cds.transaction(req);

    // 1) Carrinho & Itens
    const carrinho = await tx.run(SELECT.one.from(Carrinho).where({ usuario }));
    if (!carrinho) return req.reject(404, 'Carrinho não encontrado para este usuário.');

    const itens = await tx.run(
      SELECT.from(CarrinhoItem).where({ carrinho_ID: carrinho.ID })
    );
    if (!itens || itens.length === 0) return req.reject(404, 'Carrinho vazio.');

    // 2) Produtos (snapshot)
    const ids = itens.map(i => i.produto_ID);
    const prods = await tx.run(
      SELECT.from(Produtos).columns('ID','nome','estoque','preco').where({ ID: { in: ids } })
    );
    const byId = Object.fromEntries(prods.map(p => [p.ID, p]));

    // 3) Se NÃO vamos aguardar produção, já levante faltas com base no snapshot
    const faltas = [];
    if (!aguard) {
      for (const it of itens) {
        const p = byId[it.produto_ID];
        if (!p) {
          faltas.push({ produtoID: it.produto_ID, nome: '(produto não encontrado)', disponivel: 0, solicitada: it.quantidade, faltam: it.quantidade });
          continue;
        }
        const est = Number(p.estoque || 0);
        const q   = Number(it.quantidade || 0);
        if (q > est) {
          faltas.push({ produtoID: p.ID, nome: p.nome, disponivel: est, solicitada: q, faltam: q - est });
        }
      }
      if (faltas.length) {
        const msg = 'Estoque insuficiente: ' + faltas.map(f => `${f.nome} (disp. ${f.disponivel}, faltam ${f.faltam})`).join('; ');
        return req.reject(409, msg);
      }
    }

    // 4) Cria Pedido (dentro da mesma transação)
    const pedidoID = cds.utils.uuid();
    const total = itens.reduce((acc, it) => {
      const p = byId[it.produto_ID];
      const unit = Number(p?.preco ?? it.precoUnitario ?? 0);
      return acc + unit * Number(it.quantidade || 0);
    }, 0);

    await tx.run(
      INSERT.into(Pedidos).entries({
        ID: pedidoID,
        usuario,
        status: 'PENDENTE',
        total
      })
    );

    // 5) Debita estoques de forma atômica + cria itens do pedido
    const conflitosConcorrencia = [];
    for (const it of itens) {
      const p = byId[it.produto_ID];
      const unit = Number(p?.preco ?? it.precoUnitario ?? 0);
      const q = Number(it.quantidade || 0);
      const est = Number(p?.estoque || 0);

      // Se aguardar produção, debita somente o que existir, sem ficar negativo:
      const pretendido = aguard ? Math.min(q, est) : q;

      if (pretendido > 0 && p) {
        // UPDATE atômico: só aplica se o estoque atual no DB ainda é o que lemos
        const novoEstoque = est - pretendido;
        const affected = await tx.run(
          UPDATE(Produtos)
            .set({ estoque: novoEstoque })
            .where({ ID: p.ID, estoque: est })
        );

        if (!affected) {
          // alguém alterou o estoque entre o snapshot e o UPDATE
          conflitosConcorrencia.push(p.nome);
        } else {
          // refletir no snapshot local para próximos itens do mesmo produto (raro, mas seguro)
          byId[p.ID].estoque = novoEstoque;
        }
      }

      // Cria item do pedido independente (se não houve rejeição global)
      await tx.run(
        INSERT.into(PedidoItem).entries({
          ID: cds.utils.uuid(),
          pedido_ID    : pedidoID,
          produto_ID   : it.produto_ID,
          quantidade   : q,
          precoUnitario: unit,
          total        : unit * q
        })
      );
    }

    if (conflitosConcorrencia.length && !aguard) {
      // Estouro por concorrência → faz rollback retornando 409
      return req.reject(409, `Estoque alterado por outra operação: ${conflitosConcorrencia.join(', ')}. Tente novamente.`);
    }

    // 6) Limpa carrinho
    await tx.run(DELETE.from(CarrinhoItem).where({ carrinho_ID: carrinho.ID }));

    return `Pedido criado com sucesso (ID: ${pedidoID}). Total R$ ${total.toFixed(2)}.`;
  });

  /** -------------------- PAGAMENTO -------------------- */
  this.on('realizarPagamento', async (req) => {
    const { pedidoID, formaPagamento } = req.data;
    const formasValidas = ["PIX", "CARTAO_CREDITO", "CARTAO_DEBITO"];

    if (!pedidoID) return req.error(400, 'ID do pedido é obrigatório');
    if (!formaPagamento || !formasValidas.includes(formaPagamento)) {
      return req.error(400, `Forma de pagamento inválida. Valores permitidos: ${formasValidas.join(", ")}`);
    }

    const pedido = await SELECT.one.from(Pedidos).where({ ID: pedidoID });
    if (!pedido) return req.error(404, 'Pedido não encontrado');
    if (pedido.status === 'Pago') return `O pedido ${pedidoID} já foi pago.`;

    await UPDATE(Pedidos)
      .set({ status: 'Pago', formaPagamento })
      .where({ ID: pedidoID });

    return `Pagamento realizado com sucesso para o pedido ${pedidoID} via ${formaPagamento}.`;
  });

  /** -------------------- TOTAL DO CARRINHO -------------------- */
  this.on('getTotalCarrinho', async req => {
    const { usuario } = req.data;
    const carrinho = await SELECT.one.from(Carrinho).where({ usuario });
    if (!carrinho) return { value : "R$ 0,00" };

    const { total } = await SELECT.one.from(CarrinhoItem)
      .columns`sum(total) as total`
      .where({ carrinho_ID: carrinho.ID });

    const valor = Number(total || 0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
    return { value : valor };
  });

  /** -------------------- CANCELAR PEDIDO -------------------- */
  this.on('cancelarPedido', async (req) => {
    const { pedidoID } = req.data;
    const tx = cds.transaction(req);

    await tx.run(
      UPDATE('my.vendas.Pedidos')
        .set({ status: 'CANCELADO' })
        .where({ ID: pedidoID })
    );

    return `Pedido ${pedidoID} cancelado com sucesso!`;
  });
});
