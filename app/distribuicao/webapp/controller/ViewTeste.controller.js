sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/Fragment",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Sorter",

], function(Controller, Fragment, MessageBox, MessageToast,  Filter, FilterOperator, JSONModel, Sorter) {
  "use strict";

  return Controller.extend("distribuicao.controller.ViewTeste", {
    onInit: function () {
      const oTbl = this.byId("tblPedidos");
      oTbl.setNoDataText("Selecione seu centro de distribuição");
      this._oSelecionados = [];
      this._sortCidadeDesc = false;  // começa asc

    },

    onAbrirFragmentoAgrupamento: async function () {
      // 0) Centro selecionado
      const sCentroId = this.byId("cbCentro").getSelectedKey();
      if (!sCentroId) {
        MessageBox.warning("Selecione um centro de distribuição primeiro.");
        return;
      }

      // 1) Carrega fragmento (uma vez)
      if (!this._oFragmentAgrupamento) {
        this._oFragmentAgrupamento = await Fragment.load({
          name: "distribuicao.view.Fragments.FragmentAgruparPedidos",
          id: this.getView().getId(),
          controller: this
        });
        this.getView().addDependent(this._oFragmentAgrupamento);
      }

      // 2) Model auxiliar para seleção
      const oSelecaoModel = new JSONModel({ selectedKeys: {} });
      this.getView().setModel(oSelecaoModel, "selecao");

      // 3) Zera seleção em memória
      this._oSelecionados = [];

      // 4) Abre o dialog
      this._oFragmentAgrupamento.open();

      // 5) Bind/Filter da tabela do fragmento por centro_ID
      await this._bindPedidosParaAgruparPorCentro(sCentroId);
    }, 
    
    _bindPedidosParaAgruparPorCentro: async function (sCentroId) {
      const sFragId = this.getView().getId();
      const oTable  = sap.ui.core.Fragment.byId(sFragId, "tblPedidosParaAgrupar");
      if (!oTable) return;
    
      // Primeiro bind: cria se ainda não existir
      let oBinding = oTable.getBinding("items");
      if (!oBinding) {
        const oTemplate = sap.ui.core.Fragment.byId(sFragId, "itemListaDialogPedidos");
        oTable.bindItems({
          path: "/PedidosProntosEntrega",
          template: oTemplate.clone() // evita conflito de IDs
        });
        oBinding = oTable.getBinding("items");
      }
    
      // Filtros: centro + status PRONTO
      const aFilters = [
        new sap.ui.model.Filter({
          path: "centro_ID",
          operator: sap.ui.model.FilterOperator.EQ,
          value1: sCentroId,
          valueType: "Edm.Guid" // força guid'...' no $filter
        }),
        new sap.ui.model.Filter("status", sap.ui.model.FilterOperator.EQ, "PRONTO")
      ];
    
      oBinding.filter(aFilters);
      oTable.setNoDataText("Sem pedidos PRONTO para o centro selecionado.");
    },

    onPedidoCheckboxSelecionado: function (oEvent) {
      const oCheckBox    = oEvent.getSource();
      const bSelecionado = oEvent.getParameter("selected");
      const oData        = oCheckBox.getBindingContext().getObject();
      const oSelModel    = this.getView().getModel("selecao");
      const mSelected    = oSelModel.getProperty("/selectedKeys") || {};

      if (bSelecionado) {
        if (this._oSelecionados.length >= 3) {
          MessageToast.show("Você só pode selecionar até 3 pedidos.");
          oCheckBox.setSelected(false);
          return;
        }
        this._oSelecionados.push(oData);
        mSelected[oData.pedidoID] = true;
      } else {
        this._oSelecionados = this._oSelecionados.filter(p => p.pedidoID !== oData.pedidoID);
        delete mSelected[oData.pedidoID];
      }

      oSelModel.setProperty("/selectedKeys", mSelected);
    },

    onSelecionarTresPedidos: function () {
      const sFragId = this.getView().getId();
      const oTable  = sap.ui.core.Fragment.byId(sFragId, "tblPedidosParaAgrupar");
      if (!oTable) return MessageToast.show("Tabela ainda não carregada, tenta de novo 😉");

      const aItems = oTable.getItems();

      // limpa seleções
      this._oSelecionados = [];
      const oSelModel = this.getView().getModel("selecao");
      oSelModel.setProperty("/selectedKeys", {});
      aItems.forEach(item => item.getCells()[0].setSelected(false));

      // agrupa por cidade e escolhe 3
      const mCidades = {};
      aItems.forEach(item => {
        const oData = item.getBindingContext().getObject();
        (mCidades[oData.cidade] ||= []).push({ item, data: oData });
      });

      const aSelecionados =
        Object.values(mCidades).find(arr => arr.length >= 3)?.slice(0, 3)
        || aItems.slice(0, 3).map(item => ({ item, data: item.getBindingContext().getObject() }));

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
      .setParameter("pedidos", aIds)
      .setParameter("novoStatus", "SELECIONADO");    
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
    },

    _getCentroSelecionado: function () {
      return this.byId("cbCentro").getSelectedKey() || null;
    },
    
    _getStatusSelecionados: function () {
      return this.byId("mcbStatus").getSelectedKeys(); // array
    },
    
    _bindTabelaSePreciso: function () {
      const oTbl = this.byId("tblPedidos");
      if (!oTbl.getBinding("items")) {
        oTbl.bindItems({
          path: "/PedidosProntosEntrega",
          template: this.byId("itemTabelaPedidos").clone()
        });
      }
      return oTbl.getBinding("items");
    },
    _applyFiltersAndSort: function () {
      const oBinding = this._bindTabelaSePreciso();
      if (!oBinding) return;
    
      const aFilters = [];
    
      // Centro (GUID)
      const sCentroId = this._getCentroSelecionado();
      if (sCentroId) {
        aFilters.push(new Filter({
          path: "centro_ID",
          operator: FilterOperator.EQ,
          value1: sCentroId,
          valueType: "Edm.Guid"
        }));
      }
    
      // Status (OR entre selecionados)
      const aStatus = this._getStatusSelecionados();
      if (aStatus.length) {
        const aOr = aStatus.map(st => new Filter("status", FilterOperator.EQ, st));
        aFilters.push(new Filter({ filters: aOr, and: false })); // OR
      }
    
      oBinding.filter(aFilters);
    
      // Sort por cidade
      oBinding.sort([ new Sorter("cidade", this._sortCidadeDesc) ]);
    
      const oTbl = this.byId("tblPedidos");
      if (!sCentroId) {
        oTbl.setNoDataText("Selecione seu centro de distribuição");
      } else if (!aStatus.length) {
        oTbl.setNoDataText("Sem pedidos para o centro selecionado.");
      } else {
        oTbl.setNoDataText("Sem pedidos para o centro + status selecionados.");
      }
    },
    onCentroChange: function () {
      this._applyFiltersAndSort();
    },
    
    onStatusChange: function () {
      this._applyFiltersAndSort();
    },
    
    onToggleSortCidade: function () {
      this._sortCidadeDesc = !this._sortCidadeDesc; // alterna
      this._applyFiltersAndSort();
    },
    
    onLimparFiltros: function () {
      this.byId("cbCentro").setSelectedKey("");
      this.byId("mcbStatus").removeAllSelectedItems();
      this._applyFiltersAndSort();
      MessageToast.show("Filtros limpos.");
    },    
    
  });
});
