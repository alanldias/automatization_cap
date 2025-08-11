sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/m/MessageToast"
], function (Controller, History, MessageToast) {
    "use strict";

    return Controller.extend("vendas.controller.ProductDetail", {

        onInit: function () {
            this.getOwnerComponent().getRouter()
                .getRoute("ProductDetail")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            const sID = oEvent.getParameter("arguments").productID;
            const sPath = `/Produtos(${sID})`;        
            this.getView().bindElement(sPath);
        },

        onNavBack: function () {
            const oHistory = History.getInstance();
            const sPrevHash = oHistory.getPreviousHash();

            if (sPrevHash) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter()
                    .navTo("RouteCatalogo", {}, true);
            }
        },

        onAddToCart: function () {
            const oProd = this.getView().getBindingContext().getObject();
            const usuario = "bia";

            this.getView().getModel().bindContext(`/addToCart(...)`)
                .setParameter("usuario", usuario)
                .setParameter("produtoID", oProd.ID)
                .setParameter("quantidade", 1)
                .execute()
                .then(() => {
                    MessageToast.show(`"${oProd.nome}" adicionado ao carrinho!`);
                    sap.ui.getCore().getEventBus()
                        .publish("CartChannel", "CartUpdated");
                })
                .catch((err) => {
                    console.error(err);
                    MessageToast.show("Erro ao adicionar produto.");
                });
        }
    });
});
