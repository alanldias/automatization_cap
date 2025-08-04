sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (Controller, MessageToast) {
    "use strict";

    return Controller.extend("producao.producao.controller.View1", {

        onInit: function () {
            this._iniciarAutoAtualizacaoTabela();
        },

        onExit: function () {
            clearInterval(this._intervalID); // limpa o intervalo ao sair da view
        },

        _iniciarAutoAtualizacaoTabela: function () {
            const that = this;
            this._intervalID = setInterval(function () {
                const oTable = that.byId("tableOrdensProducao");
                const oBinding = oTable.getBinding("items");
                if (oBinding) {
                    oBinding.refresh(); // atualiza só a tabela
                }
            }, 10000); // 5000 ms = 5 segundos
        },

        onConfirmarProducao: async function (oEvent) {
            const oItem = oEvent.getSource().getParent();
            const oContext = oItem.getBindingContext();
            const ordemID = oContext.getProperty("ID");
            console.log("✅ ID da ordem:", ordemID);

            const oModel = this.getView().getModel();

            // 1️⃣ cria o binding da action import
            const oAction = oModel.bindContext("/confirmarProducaoProduto(...)", null, {
                // opcional: $$groupId se quiser batch
            });

            // 2️⃣ seta o parâmetro esperado pelo backend
            oAction.setParameter("ordemProducao_ID", ordemID);

            try {
                await oAction.execute();
                MessageToast.show("Produção concluída!");
                oModel.refresh(); 
            } catch (err) {
                MessageToast.show("Erro: " + err.message);
                console.error(err);
            }
        },

        onAtualizar: function () {
            this.getView().getModel().refresh();
        }

    });
});
