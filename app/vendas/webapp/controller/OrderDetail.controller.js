sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/Dialog",
  "sap/m/Select",
  "sap/ui/core/Item",
  "sap/m/Button",
  "sap/m/Label",
  "sap/m/VBox"
], function ( Controller, MessageToast, Dialog, Select, Item, Button, Label, VBox ) {
  "use strict";
  return Controller.extend("vendas.controller.OrderDetail", {

    onInit() {
      this.getOwnerComponent().getRouter()
        .getRoute("OrderDetail")
        .attachPatternMatched(this._onRouteMatched, this);
    },

    _onRouteMatched(oEvent) {
      const sID = oEvent.getParameter("arguments").orderID;
      this.getView().bindElement({
        path: `/Pedidos('${sID}')`,
        parameters: {
          $expand: "itens($expand=produto)"
        }
      });
    },

    formatOrderStatusState(sStatus) {
      switch (sStatus) {
        case "Pago": return "Success";
        case "Pendente": return "Warning";
        case "Cancelado": return "Error";
        default: return "None";
      }
    },

    formatOrderDate(vDate) {
      return vDate
        ? new Date(vDate).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "2-digit"
        })
        : "";
    },

    isPayEnabled: s => s === "Pendente",
    isCancelEnabled: s => s === "Pendente",

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("Orders", {}, true);
    },

    onPay: function () {
      const oView = this.getView();
      const oCtx = oView.getBindingContext();
      const oItem = oCtx.getObject();
      const oModel = oView.getModel();

      const oSelect = new Select({
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
          press: () => {
            const sForma = oSelect.getSelectedKey();

            oModel.bindContext("/realizarPagamento(...)", undefined, {
              $$updateGroupId: "$auto"
            })
              .setParameter("pedidoID", oItem.ID)
              .setParameter("formaPagamento", sForma)
              .execute()
              .then((sMsg) => {
                MessageToast.show(
                  sMsg || `Pagamento do pedido ${oItem.ID} via ${sForma} realizado!`
                );
                oDialog.close();
                this.getOwnerComponent().getRouter()
                  .navTo("Orders", {}, true);
              })
              .catch((oErr) => {
                console.error(oErr);
                MessageToast.show("Erro ao processar pagamento.");
                oDialog.close();
              });
          }
        }),
        endButton: new Button({
          text: "Cancelar",
          press: () => oDialog.close()
        }),
        afterClose: () => oDialog.destroy()
      });

      oView.addDependent(oDialog);
      oDialog.open();
    },

    onCancel() {
      const oView = this.getView();
      const oModel = oView.getModel();
      const sID = oView.getBindingContext().getProperty("ID");
      const oRouter = this.getOwnerComponent().getRouter();
      const oAction = oModel.bindContext("/cancelarPedido(...)", undefined, {
        $$updateGroupId: "$auto"
      });

      oAction
        .setParameter("pedidoID", sID)
        .execute()
        .then((sMessage) => {
          MessageToast.show(sMessage || `Pedido ${sID} cancelado com sucesso!`);
          oView.unbindElement();
          oRouter.navTo("Orders", {}, true);
        })
        .catch((oErr) => {
          console.error(oErr);
          MessageToast.show("Não foi possível cancelar o pedido.");
        });
    }
  });
});
