sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/Dialog",
  "sap/m/Select",
  "sap/ui/core/Item",
  "sap/m/Button",
  "sap/m/Label",
  "sap/m/VBox"
], function (
  Controller,
  MessageToast,
  Dialog,
  Select,
  Item,
  Button,
  Label,
  VBox
) {
  "use strict";
  return Controller.extend("vendas.controller.OrderDetail", {

    onInit() {
      this.getOwnerComponent().getRouter()
        .getRoute("OrderDetail")
        .attachPatternMatched(this._onRouteMatched, this);
    },

    _onRouteMatched(oEvent) {
      const sID = oEvent.getParameter("arguments").orderID;
      // String literal (UUID) entre aspas, sem guid'
      this.getView().bindElement({
        path: `/Pedidos('${sID}')`,
        parameters: {
          // nested expand: expande 'itens' e dentro deles 'produto'
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

    /** abre o popup para escolher forma e chama a action */
    onPay: function () {
      const oView = this.getView();
      const oCtx = oView.getBindingContext();
      const oItem = oCtx.getObject();
      const oModel = oView.getModel();

      // 1) Select com as formas
      const oSelect = new Select({
        width: "100%",
        items: [
          new Item({ key: "PIX", text: "Pix" }),
          new Item({ key: "CARTAO_CREDITO", text: "Cartão de Crédito" }),
          new Item({ key: "CARTAO_DEBITO", text: "Cartão de Débito" })
        ]
      });

      // 2) Dialog
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

            // 3) Chama a action no backend
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
                // volta pra lista e faz refresh lá (você já tem o hook em Orders.onInit)
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

    // OrderDetail.controller.js
    onCancel() {
      const oView = this.getView();
      const oModel = oView.getModel();
      const sID = oView.getBindingContext().getProperty("ID");
      const oRouter = this.getOwnerComponent().getRouter();

      // Cria o binding para a action cancelarPedido
      const oAction = oModel.bindContext("/cancelarPedido(...)", undefined, {
        $$updateGroupId: "$auto"
      });

      oAction
        .setParameter("pedidoID", sID)
        .execute()
        .then((sMessage) => {
          MessageToast.show(sMessage || `Pedido ${sID} cancelado com sucesso!`);

          // Desvincula totalmente o binding do detalhe
          oView.unbindElement();

          // Agora navega de volta sem que o detalhe tente refresh automático
          oRouter.navTo("Orders", {}, true);
        })
        .catch((oErr) => {
          console.error(oErr);
          MessageToast.show("Não foi possível cancelar o pedido.");
        });
    }
  });
});
