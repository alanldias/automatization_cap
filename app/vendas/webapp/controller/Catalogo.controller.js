sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
    "use strict";

    return Controller.extend("vendas.controller.Catalogo", {
        onAddToCart: function (oEvent) {
            const oItem = oEvent.getSource().getBindingContext().getObject();
            const usuario = "bia";
        
            this.getView().getModel().bindContext(`/addToCart(...)`)
                .setParameter("usuario", usuario)
                .setParameter("produtoID", oItem.ID)
                .setParameter("quantidade", 1)
                .execute()
                .then(() => {
                    sap.m.MessageToast.show(`Produto "${oItem.nome}" adicionado ao carrinho!`);
                    sap.ui.getCore().getEventBus()
                        .publish("CartChannel", "CartUpdated");
                })
                .catch((err) => {
                    console.error(err);
                    sap.m.MessageToast.show("Erro ao adicionar produto.");
                });
        },
        

        onGoToCart: function () {
            this.getOwnerComponent().getRouter().navTo("Cart");
        }
    });
});
