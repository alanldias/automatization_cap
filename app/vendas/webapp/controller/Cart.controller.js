sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox"
], function (Controller, MessageToast, JSONModel, MessageBox) {
  "use strict";

  return Controller.extend("vendas.controller.Cart", {

    onInit: function () {
      // ViewModel para UI (total, busy, etc.)
      const oViewModel = new JSONModel({
        totalCarrinho: "Total: R$ 0,00",
        busyCheckout : false
      });
      this.getView().setModel(oViewModel, "view");

      // Atualiza lista quando o catálogo avisar
      sap.ui.getCore().getEventBus()
        .subscribe("CartChannel", "CartUpdated", this._onCartUpdated, this);

      // Recalcula total quando a lista carregar/atualizar
      const oList = this.byId("cartList");
      if (oList) {
        const oBinding = oList.getBinding("items");
        if (oBinding) {
          oBinding.attachDataReceived(() => this._atualizarTotalAPartirDaLista());
        }
      }
    },

    _onCartUpdated: function () {
      const oList = this.byId("cartList");
      if (oList) {
        const oBinding = oList.getBinding("items");
        if (oBinding) oBinding.refresh();
      }
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("RouteCatalogo", {}, true);
    },

    /** Soma o total a partir dos contexts atuais da lista (OData V4) */
    _atualizarTotalAPartirDaLista: function () {
      const oList = this.byId("cartList");
      if (!oList) return;

      const oBinding = oList.getBinding("items");
      if (!oBinding) return;

      const aCtx = oBinding.getCurrentContexts ? oBinding.getCurrentContexts() : [];
      const total = aCtx.reduce((acc, ctx) => {
        const v = Number(ctx.getProperty("total") || 0);
        return acc + v;
      }, 0);

      const sBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total);
      this.getView().getModel("view").setProperty("/totalCarrinho", `Total: ${sBRL}`);
    },

    onRemoveFromCart: function (oEvent) {
      const oItem  = oEvent.getSource().getBindingContext().getObject();
      const oModel = this.getView().getModel();
      const oList  = this.byId("cartList");

      oModel.bindContext(`/removeFromCart(...)`)
        .setParameter("itemID", oItem.ID)
        .execute()
        .then(() => {
          MessageToast.show(`Item "${oItem.produto.nome}" removido do carrinho.`);
          if (oList) {
            const oBinding = oList.getBinding("items");
            if (oBinding) oBinding.refresh();
          }
        })
        .catch((err) => {
          console.error(err);
          MessageToast.show("Erro ao remover item.");
        });
    },

    /** === Helpers p/ tratar 409 de estoque e normalizar mensagem === */
    _isConflictMsg: function (err) {
      const m = (err && (err.message || err.toString())) || "";
      const code = err?.status || err?.httpStatus || err?.cause?.status || err?.error?.status;
      return (code === 409) || /409/i.test(m) || /Estoque insuficiente|Quantidade indisponível/i.test(m);
    },

    /** Extrai itens "Nome (disp. N, faltam M)" da mensagem crua do backend */
    _parseShortages: function (sErr) {
      const out = [];
      if (!sErr) return out;

      // pega trecho após "Estoque insuficiente:"
      const after = (sErr.split("Estoque insuficiente:")[1] || sErr).trim();

      // itens separados por ';'
      after.split(";").forEach(chunk => {
        const c = chunk.trim();
        if (!c) return;

        const nameMatch = c.match(/^\s*([^()]+?)\s*\(/); // nome antes do "("
        const numsMatch = c.match(/\(\s*disp\.\s*([0-9]+)\s*,\s*faltam\s*([0-9]+)\s*\)/i);

        if (numsMatch) {
          out.push({
            nome       : (nameMatch ? nameMatch[1] : "").trim(),
            disponivel : Number(numsMatch[1]),
            faltam     : Number(numsMatch[2])
          });
        }
      });
      return out;
    },

    /** Monta texto amigável garantindo rótulos corretos (Disponíveis/Faltam) */
    _formatShortageMsg: function (sErr) {
      const items = this._parseShortages(sErr);
      if (!items.length) return sErr || "Estoque insuficiente.";
      const linhas = items.map(i =>
        `- ${i.nome}: Disponíveis ${i.disponivel} • Faltam ${i.faltam}`
      );
      return `Estoque insuficiente:\n${linhas.join("\n")}`;
    },

    onCheckout: function () {
      const oView   = this.getView();
      const oModel  = oView.getModel();
      const usuario = "bia"; // TODO: trocar para usuário logado
      const oPage   = this.byId("cartPage");

      const setBusy = (b) => {
        this.getView().getModel("view").setProperty("/busyCheckout", !!b);
        if (oPage && oPage.setBusy) oPage.setBusy(!!b);
      };

      const callFinalize = (esperaProducao) => {
        return oModel
          .bindContext("/finalizarPedido(...)", undefined, { $$updateGroupId: "$auto" })
          .setParameter("usuario", usuario)
          .setParameter("esperaProducao", !!esperaProducao)
          .execute();
      };

      setBusy(true);

      // 1ª tentativa: sem aguardar produção
      callFinalize(false)
        .then((oCtxRet) => {
          const sMsg = (oCtxRet && oCtxRet.getBoundContext && oCtxRet.getBoundContext().getObject && oCtxRet.getBoundContext().getObject().value)
                    || (typeof oCtxRet === "string" ? oCtxRet : null)
                    || "Pedido criado!";
          MessageToast.show(sMsg);
          sap.ui.getCore().getEventBus().publish("CartChannel", "CartUpdated");
          this.getOwnerComponent().getRouter().navTo("Orders", {}, true);
        })
        .catch((err) => {
          const sErr = (err && (err.message || err.toString())) || "";
          const isConflict = this._isConflictMsg(err);

          if (isConflict) {
            const sNice = this._formatShortageMsg(sErr);
            MessageBox.confirm(
              `${sNice}\n\nDeseja aguardar o tempo de produção e mesmo assim finalizar?`,
              {
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: (sAction) => {
                  if (sAction === MessageBox.Action.YES) {
                    setBusy(true);
                    callFinalize(true)
                      .then((oCtxRet2) => {
                        const sMsg2 = (oCtxRet2 && oCtxRet2.getBoundContext && oCtxRet2.getBoundContext().getObject && oCtxRet2.getBoundContext().getObject().value)
                                    || (typeof oCtxRet2 === "string" ? oCtxRet2 : null)
                                    || "Pedido criado!";
                        MessageToast.show(sMsg2);
                        sap.ui.getCore().getEventBus().publish("CartChannel", "CartUpdated");
                        this.getOwnerComponent().getRouter().navTo("Orders", {}, true);
                      })
                      .catch((e2) => {
                        console.error(e2);
                        MessageToast.show("Não foi possível finalizar o pedido.");
                      })
                      .finally(() => setBusy(false));
                  } else {
                    MessageToast.show("Pedido não finalizado.");
                    setBusy(false);
                  }
                }
              }
            );
          } else {
            console.error(err);
            MessageToast.show("Erro ao finalizar pedido.");
            setBusy(false);
          }
        });
      // o busy é solto no fluxo acima para evitar piscar entre confirmações
    }
  });
});
