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
            const oViewModel = new JSONModel({
                totalCarrinho: "Total: R$ 0,00"
            });
            this.getView().setModel(oViewModel, "view");

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
                oList.getBinding("items").refresh(); 
            }
        },

        onNavBack: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("RouteCatalogo", {}, true);
        },

        _calcularTotal: function () {
            const oModel = this.getView().getModel();
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
                    oModel.refresh();
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
                    oModel.refresh();
                    this.getOwnerComponent().getRouter()
                        .navTo("Orders", {}, true);
                })
                .catch((err) => {
                    console.error(err);
                    MessageToast.show(err);
                });
        }
    });
});
