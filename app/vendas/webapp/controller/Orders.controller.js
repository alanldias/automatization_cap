sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Select",
    "sap/ui/core/Item",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/VBox"
], function (Controller, MessageToast, Dialog, Select, Item, Button, Label, VBox) {
    "use strict";

    return Controller.extend("vendas.controller.Orders", {
        onInit: function () {
            // ao entrar na rota "Orders", chama _onRouteMatched
            this.getOwnerComponent().getRouter()
              .getRoute("Orders")
              .attachPatternMatched(this._onRouteMatched, this);
          },

          _onRouteMatched: function () {
            const oList = this.byId("ordersList");
            if (oList) {
              oList.getBinding("items").refresh();
            }
          },

        onPay: function (oEvent) {
            const oItem = oEvent.getSource().getBindingContext().getObject();
            const oView = this.getView();
            const oModel = oView.getModel();

            // Criar diálogo para escolher forma de pagamento
            const oSelect = new Select("selectFormaPagamento", {
                width: "100%",
                items: [
                    new Item({ key: "PIX", text: "Pix" }),
                    new Item({ key: "CARTAO_CREDITO", text: "Cartão de Crédito" }),
                    new Item({ key: "CARTAO_DEBITO", text: "Cartão de Débito" })
                ]
            });

            const oDialog = new Dialog({
                title: "Escolher Forma de Pagamento",
                content: new VBox({
                    items: [
                        new Label({ text: "Selecione a forma de pagamento:" }),
                        oSelect
                    ]
                }),
                beginButton: new Button({
                    text: "Confirmar",
                    press: function () {
                        const formaPagamento = oSelect.getSelectedKey();
                        console.log("💳 Forma de pagamento selecionada:", formaPagamento);

                        // Chamar ação do backend
                        oModel.bindContext(`/realizarPagamento(...)`)
                            .setParameter("pedidoID", oItem.ID)
                            .setParameter("formaPagamento", formaPagamento)
                            .execute()
                            .then(() => {
                                MessageToast.show(`Pagamento do pedido ${oItem.ID} via ${formaPagamento} realizado com sucesso!`);
                                oModel.refresh();
                            })
                            .catch((err) => {
                                console.error(err);
                                MessageToast.show("Erro ao realizar pagamento.");
                            });

                        oDialog.close();
                    }
                }),
                endButton: new Button({
                    text: "Cancelar",
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oView.addDependent(oDialog);
            oDialog.open();
        },

        /* Navegação de retorno */
        onNavBack: function () {
            this.getOwnerComponent().getRouter()
                .navTo("RouteCatalogo", {}, true);
        },

        /* Formata a cor (state) do ObjectStatus */
        formatOrderStatusState: function (sStatus) {
            switch (sStatus) {
                case "Pago":      return "Success";
                case "Pendente":  return "Warning";
                case "Cancelado": return "Error";
                default:          return "None";
            }
        },
        isPayEnabled: function (sStatus) {
            // só habilita se o pedido estiver PENDENTE
            return sStatus === "Pendente";
        },
        formatOrderDate: function (vDate) {
            // vDate é uma string ISO (ou timestamp) — faz a conversão segura
            if (!vDate) { return ""; }
        
            const oDate = new Date(vDate);          // cria objeto Date
            // Usa o locale do browser; ajuste se quiser algo fixo (pt-BR, por ex.)
            return oDate.toLocaleDateString(undefined, { 
                year:  "numeric",
                month: "short",
                day:   "2-digit"
            });
        },
        onOpenDetail: function (oEvent) {
            const sOrderID = oEvent.getSource()        // CustomListItem
                                   .getBindingContext()
                                   .getProperty("ID"); // chave vinda do OData
        
            this.getOwnerComponent()
                .getRouter()
                .navTo("OrderDetail", { orderID: sOrderID });
        }
        
        
    });
});
