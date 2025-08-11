sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/m/MessageToast"
], function (Controller, History, MessageToast) {
    "use strict";

    return Controller.extend("vendas.controller.ProductDetail", {

        onInit: function () {
            // Quando a rota "ProductDetail" for correspondente, vincula o produto.
            this.getOwnerComponent().getRouter()
                .getRoute("ProductDetail")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        /* Vincula a página ao produto solicitado */
        _onRouteMatched: function (oEvent) {
            const sID = oEvent.getParameter("arguments").productID;   // ID na URL
            const sPath = `/Produtos(${sID})`;                        // caminho OData
            this.getView().bindElement(sPath);
        },

        /* Botão Voltar */
        onNavBack: function () {
            const oHistory = History.getInstance();
            const sPrevHash = oHistory.getPreviousHash();

            if (sPrevHash) {
                window.history.go(-1);           // volta para onde estava
            } else {
                this.getOwnerComponent().getRouter()
                    .navTo("RouteCatalogo", {}, true); // fallback
            }
        },

        /* Botão Adicionar ao Carrinho */
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
                    // Notifica o carrinho (EventBus já implementado)
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
