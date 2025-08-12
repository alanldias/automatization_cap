sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/routing/History",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, History, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("vendas.controller.ProductDetail", {

    onInit: function () {
      this.getOwnerComponent().getRouter()
        .getRoute("ProductDetail")
        .attachPatternMatched(this._onRouteMatched, this);
    },

    _onRouteMatched: function (oEvent) {
      const sID = oEvent.getParameter("arguments").productID;
      this.getView().bindElement({ path: `/Produtos('${sID}')` });
    },

    onNavBack: function () {
      const oHistory = History.getInstance();
      oHistory.getPreviousHash()
        ? window.history.go(-1)
        : this.getOwnerComponent().getRouter().navTo("RouteCatalogo", {}, true);
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
          if (this._isConflict(err) && !esperaProducao) {
            MessageBox.confirm(
              `Quantidade indisponível no estoque.\n\nDeseja aguardar o tempo de produção e mesmo assim adicionar?`,
              {
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: (sAction) => {
                  if (sAction === MessageBox.Action.YES) {
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

    onAddToCart: function () {
      const oView   = this.getView();
      const oModel  = oView.getModel();
      const oCtx    = oView.getBindingContext();
      const oProd   = oCtx.getObject();
      const usuario = "bia";

      let oStep = oView.byId("stepQtyDetail");
      if (!oStep) {
        const aSteps = oView.findAggregatedObjects(true, c => c.isA && c.isA("sap.m.StepInput"));
        oStep = aSteps && aSteps[0];
      }
      const quantidade = Math.max(1, parseInt(oStep ? oStep.getValue() : "1", 10) || 1);

      const proceed = (estoqueAtual) => {
        if (Number(estoqueAtual) >= quantidade) {
          this._addToCart(oModel, {
            usuario, produtoID: oProd.ID, quantidade, nome: oProd.nome, esperaProducao: false
          }, oStep);
          return;
        }

        const disp  = Number(estoqueAtual) || 0;
        const falta = quantidade - disp;

        MessageBox.confirm(
          `Quantidade indisponível no estoque.\nDisponíveis: ${disp}. Faltam: ${falta}.\n\nDeseja aguardar o tempo de produção e mesmo assim adicionar?`,
          {
            actions: [MessageBox.Action.YES, MessageBox.Action.NO],
            emphasizedAction: MessageBox.Action.YES,
            onClose: (sAction) => {
              if (sAction === MessageBox.Action.YES) {
                this._addToCart(oModel, {
                  usuario, produtoID: oProd.ID, quantidade, nome: oProd.nome, esperaProducao: true
                }, oStep);
              } else {
                MessageToast.show("Produto não adicionado.");
              }
            }
          }
        );
      };

      if (oProd.estoque === undefined) {
        oCtx.requestProperty("estoque").then(proceed).catch(() => proceed(0));
      } else {
        proceed(oProd.estoque);
      }
    }
  });
});
