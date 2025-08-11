sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel"
], function (Controller, MessageToast, JSONModel) {
    "use strict";

    return Controller.extend("vendas.controller.Cart", {
        onInit: function () {
            sap.ui.getCore().getEventBus()
                .subscribe("CartChannel", "CartUpdated",
                    this._onCartUpdated, this);
            // Modelo JSON para dados locais da view
            const oViewModel = new JSONModel({
                totalCarrinho: "Total: R$ 0,00"
            });
            this.getView().setModel(oViewModel, "view");

            // Atualiza quando os dados do carrinho chegam
            const oList = this.byId("cartList");
            if (oList) {
                const oBinding = oList.getBinding("items");
                if (oBinding) {
                    oBinding.attachDataReceived(() => this._calcularTotal());
                }
            }
        },

        _onCartUpdated: function () {
            const oList = this.byId("cartList");
            if (oList) {
                // OData V4 → refresh() sem parâmetros
                oList.getBinding("items").refresh();   // ← sem bForceUpdate
            }
        },
        

        onNavBack: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("RouteCatalogo", {}, true);
        },

        _calcularTotal: function () {
            const oModel = this.getView().getModel(); // OData
            const aItens = oModel.getProperty("/CarrinhoItem");

            let total = 0;
            if (Array.isArray(aItens)) {
                total = aItens.reduce((acc, item) => acc + (item.total || 0), 0);
            }

            this.getView().getModel("view").setProperty("/totalCarrinho", `Total: R$ ${total.toFixed(2)}`);
        },

        onRemoveFromCart: function (oEvent) {
            const oItem = oEvent.getSource().getBindingContext().getObject();
            const oModel = this.getView().getModel();

            oModel.bindContext(`/removeFromCart(...)`)
                .setParameter("itemID", oItem.ID)
                .execute()
                .then(() => {
                    MessageToast.show(`Item "${oItem.produto.nome}" removido do carrinho.`);
                    oModel.refresh(); // ✅ Atualiza a lista no front
                })
                .catch((err) => {
                    console.error(err);
                    MessageToast.show("Erro ao remover item.");
                });
        },

        onCheckout: function () {
            const usuario = "bia"; // depois virá do login
            const oModel = this.getView().getModel();

            oModel.bindContext(`/finalizarPedido(...)`)
                .setParameter("usuario", usuario)
                .execute()
                .then(() => {
                    MessageToast.show("Pedido finalizado com sucesso!");
                    oModel.refresh(); // ✅ limpa carrinho no front
                    this.getOwnerComponent().getRouter()
                        .navTo("Orders", {}, true);   // true = substitui no histórico
                })
                .catch((err) => {
                    console.error(err);
                    MessageToast.show(err);
                });
        }
    });
});
