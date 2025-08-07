sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/Fragment",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function(Controller, Fragment, MessageBox, MessageToast) {
  "use strict";

  return Controller.extend("distribuicao.controller.ViewTeste", {
    onInit: function () {
      this._oSelecionados = [];
    },

    onAbrirFragmentoAgrupamento: async function () {
      if (!this._oFragmentAgrupamento) {
        this._oFragmentAgrupamento = await Fragment.load({
          name: "distribuicao.view.Fragments.FragmentAgruparPedidos",
          id: this.getView().getId(),
          controller: this
        });
        this.getView().addDependent(this._oFragmentAgrupamento);
      }
    
      // Cria model auxiliar para controle de checkbox
      const oSelecaoModel = new sap.ui.model.json.JSONModel({});
      this.getView().setModel(oSelecaoModel, "selecao");
    
      this._oSelecionados = [];
      this._oFragmentAgrupamento.open();
    },    

    onPedidoCheckboxSelecionado: function (oEvent) {
      const oCheckBox = oEvent.getSource();
      const bSelecionado = oEvent.getParameter("selected");
      const oContext = oCheckBox.getBindingContext();
      const oData = oContext.getObject();
      const oSelecaoModel = this.getView().getModel("selecao");
      const mSelected = oSelecaoModel.getProperty("/selectedKeys") || {};
    
      if (bSelecionado) {
        if (this._oSelecionados.length >= 3) {
          MessageToast.show("Você só pode selecionar até 3 pedidos.");
          oCheckBox.setSelected(false); // desfaz visual
          return;
        }
    
        this._oSelecionados.push(oData);
        mSelected[oData.pedidoID] = true;
      } else {
        this._oSelecionados = this._oSelecionados.filter(p => p.pedidoID !== oData.pedidoID);
        delete mSelected[oData.pedidoID];
      }
    
      oSelecaoModel.setProperty("/selectedKeys", mSelected);
    },    

    onSelecionarTresPedidos : function () {

      // 1. Acessa a tabela de forma correta
      const sFragId = this.getView().getId();                              // mesmo ID usado no load
      const oTable  = sap.ui.core.Fragment.byId(sFragId, "tblPedidosParaAgrupar");
  
      if (!oTable) {    // fragmento ainda não terminou de construir?
          return MessageToast.show("Tabela ainda não carregada, tenta de novo 😉");
      }
  
      const aItems = oTable.getItems();
  
      /* -------- limpa seleções -------- */
      this._oSelecionados = [];
      const oSelModel = this.getView().getModel("selecao");
      oSelModel.setProperty("/selectedKeys", {});        // zera JSONModel
  
      aItems.forEach(item => item.getCells()[0].setSelected(false));
  
      /* -------- agrupa por cidade -------- */
      const mCidades = {};
      aItems.forEach(item => {
          const oData   = item.getBindingContext().getObject();
          const sCidade = oData.cidade;
          (mCidades[sCidade] ||= []).push({ item, data : oData });
      });
  
      /* --------- escolhe 3 --------- */
      let aSelecionados = Object.values(mCidades)
                           .find(arr => arr.length >= 3)?.slice(0,3) // 3 da mesma cidade
                         || aItems.slice(0,3).map(item => ({         // ou 3 primeiros
                               item, data : item.getBindingContext().getObject()
                            }));
  
      /* -------- marca visual + model de seleção -------- */
      aSelecionados.forEach(sel => {
          sel.item.getCells()[0].setSelected(true);
          this._oSelecionados.push(sel.data);
          oSelModel.setProperty(`/selectedKeys/${sel.data.pedidoID}`, true);
      });
  },

    onConfirmarAgrupamento: async function () {
      if (this._oSelecionados.length === 0) {
        return MessageBox.warning("Selecione ao menos 1 pedido.");
      }

      const oModel = this.getView().getModel();
      const pedidos = this._oSelecionados.map(p => ({
        pedidoID: p.pedidoID,
        cep: p.cep,
        numero: p.numero
      }));

      // 1. Chama action realizarEntrega
      const oActionEntrega = oModel.bindContext("/realizarEntrega(...)")
        .setParameter("pedidos", pedidos);

      try {
        await oActionEntrega.execute();
        const resultado = await oActionEntrega.requestObject();

        if (!resultado.success) {
          MessageBox.error(resultado.message || "Erro ao criar entrega.");
          return;
        }

        const aIds = this._oSelecionados.map(p => p.pedidoID);

        // 2. Atualiza status para ENVIADO
        const oActionStatus = oModel.bindContext("/atualizarStatusPedidos(...)")
      .setParameter("pedidos", aIds);
        await oActionStatus.execute();
        const resStatus = await oActionStatus.requestObject();

        if (!resStatus.success) {
          MessageBox.error(resStatus.message);
          return;
        }

        MessageToast.show("Entrega criada e status atualizado.");
        oModel.refresh();
        this._oFragmentAgrupamento.close();
      } catch (e) {
        console.error(e);
        MessageBox.error("Erro inesperado ao processar entrega.");
      }
    },

    onCancelarAgrupamento: function () {
      this._oSelecionados = [];
      const oSelecaoModel = this.getView().getModel("selecao");
      oSelecaoModel.setProperty("/selectedKeys", {});
      this._oFragmentAgrupamento.close();
    },
    isPedidoSelecionado: function (sPedidoID, mSelectedKeys) {
      return !!mSelectedKeys?.[sPedidoID];
    }
  });
});
