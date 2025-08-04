sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox"


  ], function(Controller, MessageToast, MessageBox) {
    "use strict";
  
    return Controller.extend("distribuicao.controller.ViewTeste", {
      onPressEnviarPedido: function () {
        const oRouter = this.getOwnerComponent().getRouter();
      
        const sPedidoID = "123e4567-e89b-12d3-a456-426614174000";  // mock
        const sCep      = "81230416";  // mock também
        const sNumero   = "39";       // mock também
      
        oRouter.navTo("RouteViewEnvioPedidoComCodigo", {
          codigo: sPedidoID,
          cep: sCep,
          numero: sNumero
        });
      
        MessageToast.show("Redirecionando com dados...");
      },
      onPressEnviarVariosPedidos: async function () {
        const oModel = this.getView().getModel();
      
        const pedidos = [
          { pedidoID: "123e4567-e89b-12d3-a456-426614174000", cep: "81230416", numero: "39" },
          { pedidoID: "123e4567-e89b-12d3-a456-426614174001", cep: "83403190", numero: "227" },
          { pedidoID: "123e4567-e89b-12d3-a456-426614174002", cep: "80440070", numero: "" },
          { pedidoID: "123e4567-e89b-12d3-a456-426614174003", cep: "80620470", numero: "" }
        ];
      
        try {
          const oAction = oModel.bindContext("/realizarEntrega(...)")
            .setParameter("pedidos", pedidos); // <-- aqui você passa os pedidos mockados
      
          await oAction.execute();
          const resultado = await oAction.requestObject();
      
          if (!resultado.success) {
            MessageBox.error(resultado.message || "Falha ao criar entrega múltipla.");
            return;
          }
      
          MessageBox.success("Entregas múltiplas criadas com sucesso!");
          console.log("📦 Resultado:", resultado);
      
        } catch (err) {
          MessageBox.error("Erro ao enviar pedidos múltiplos.");
          console.error(err);
        }
      }       
    });
  });
  