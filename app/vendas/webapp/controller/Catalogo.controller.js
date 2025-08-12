sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (Controller, MessageToast, MessageBox, Filter, FilterOperator) {
  "use strict";

  return Controller.extend("vendas.controller.Catalogo", {
    onInit: function () {
      const oSearch = this.byId("searchCatalog");
      if (oSearch) oSearch.setValue("");
      if (this._applySearch) this._applySearch("");
    },

    _isConflict: function (err) {
      const m = (err && (err.message || err.toString())) || "";
      const code = err?.status || err?.httpStatus || err?.cause?.status || err?.error?.status;
      return (code === 409) || /409/i.test(m) || /Quantidade indisponível|Estoque insuficiente/i.test(m);
    },

    _addToCart: function (oModel, payload, oStep) {
      const { usuario, produtoID, quantidade, nome, esperaProducao } = payload;
      return oModel.bindContext(`/addToCart(...)`)
        .setParameter("usuario",        usuario)
        .setParameter("produtoID",      produtoID)
        .setParameter("quantidade",     quantidade)
        .setParameter("esperaProducao", !!esperaProducao)
        .execute()
        .then(() => {
          MessageToast.show(`"${nome}" adicionado (x${quantidade}).`);
          sap.ui.getCore().getEventBus().publish("CartChannel", "CartUpdated");
          if (oStep) oStep.setValue(1);
        })
        .catch((err) => {
          // Fallback: se o back rejeitou por falta de estoque e ainda NÃO pedimos produção
          if (this._isConflict(err) && !esperaProducao) {
            MessageBox.confirm(
              `Quantidade indisponível no estoque.\n\nDeseja aguardar o tempo de produção e mesmo assim adicionar?`,
              {
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: (sAction) => {
                  if (sAction === MessageBox.Action.YES) {
                    // reenvia com esperaProducao = true
                    this._addToCart(oModel, { ...payload, esperaProducao: true }, oStep);
                  } else {
                    MessageToast.show("Produto não adicionado.");
                  }
                }
              }
            );
          } else {
            console.error(err);
            MessageToast.show("Erro ao adicionar produto.");
          }
        });
    },

    onAddToCart: function (oEvent) {
      const oButton = oEvent.getSource();
      const oHBox   = oButton.getParent();
      const oStep   = oHBox?.getItems()?.find(c => c.isA && c.isA("sap.m.StepInput"));
      const quantidade = Math.max(1, parseInt(oStep ? oStep.getValue() : "1", 10) || 1);

      const oCtx     = oButton.getBindingContext();
      const oProduto = oCtx.getObject();
      const usuario  = "bia";
      const oModel   = this.getView().getModel();

      // Checagem local (UX) + fallback no catch garante consistência
      const proceed = (estoqueAtual) => {
        if (Number(estoqueAtual) >= quantidade) {
          // estoque local suficiente → tenta sem produção (se o back discordar, o catch trata)
          this._addToCart(oModel, {
            usuario, produtoID: oProduto.ID, quantidade, nome: oProduto.nome, esperaProducao: false
          }, oStep);
          return;
        }

        const disp = Number(estoqueAtual) || 0;
        const falta = quantidade - disp;

        MessageBox.confirm(
          `Quantidade indisponível no estoque.\nDisponíveis: ${disp}. Faltam: ${falta}.\n\nDeseja aguardar o tempo de produção e mesmo assim adicionar?`,
          {
            actions: [MessageBox.Action.YES, MessageBox.Action.NO],
            emphasizedAction: MessageBox.Action.YES,
            onClose: (sAction) => {
              if (sAction === MessageBox.Action.YES) {
                this._addToCart(oModel, {
                  usuario, produtoID: oProduto.ID, quantidade, nome: oProduto.nome, esperaProducao: true
                }, oStep);
              } else {
                MessageToast.show("Produto não adicionado.");
              }
            }
          }
        );
      };

      if (oProduto.estoque === undefined) {
        oCtx.requestProperty("estoque").then(proceed).catch(() => proceed(0));
      } else {
        proceed(oProduto.estoque);
      }
    },

    onOpenDetail: function (oEvent) {
      const sID = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("ProductDetail", { productID: sID });
    },

    onGoToCart: function () {
      this.getOwnerComponent().getRouter().navTo("Cart");
    },
    /** ========== Pesquisa ========== */
    onSearchChange: function (oEvent) {
      // liveChange (com debounce leve)
      const sQuery = oEvent.getParameter("newValue") || "";
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this._applySearch(sQuery), 200);
    },

    onSearchSubmit: function (oEvent) {
      // Enter ou botão de busca
      const sQuery = oEvent.getParameter("query") || oEvent.getSource().getValue() || "";
      this._applySearch(sQuery);
    },

    _applySearch: function (sQuery) {
      const oFlex = this.byId("productFlexBox"); // <- sua lista de produtos
      if (!oFlex) return;

      const oBinding = oFlex.getBinding("items");
      if (!oBinding) return;

      const s = (sQuery || "").trim();
      if (!s) {
        // limpa filtros
        oBinding.filter([]);
        return;
      }

      // Filtra por nome OU descrição (contains)
      const aOrFilters = [
        new Filter("nome",       FilterOperator.Contains, s),
        new Filter("descricao",  FilterOperator.Contains, s)
      ];
      const oCombined = new Filter({ filters: aOrFilters, and: false }); // (f1 OR f2)

      oBinding.filter([oCombined]);
    },
  });
});
