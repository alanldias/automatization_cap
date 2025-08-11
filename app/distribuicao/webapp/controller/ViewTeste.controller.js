sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/Fragment",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Sorter",

], function (Controller, Fragment, MessageBox, MessageToast, Filter, FilterOperator, JSONModel, Sorter) {
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
      const oTable = sap.ui.core.Fragment.byId(sFragId, "tblPedidosParaAgrupar");
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
      const oCheckBox = oEvent.getSource();
      const bSelecionado = oEvent.getParameter("selected");
      const oData = oCheckBox.getBindingContext().getObject();
      const oSelModel = this.getView().getModel("selecao");
      const mSelected = oSelModel.getProperty("/selectedKeys") || {};

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
      const oTable = sap.ui.core.Fragment.byId(sFragId, "tblPedidosParaAgrupar");
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
        return sap.m.MessageBox.warning("Selecione ao menos 1 pedido.");
      }
      await this.onAbrirDialogVeiculo();
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
      oBinding.sort([new Sorter("cidade", this._sortCidadeDesc)]);

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

    onAbrirDialogVeiculo: async function () {
      if (!this._dlgVeiculo) {
        this._dlgVeiculo = await Fragment.load({
          name: "distribuicao.view.Fragments.FragmentSelecionarVeiculo",
          id: this.getView().getId(),
          controller: this
        });
        this.getView().addDependent(this._dlgVeiculo);
      }

      const sCentroId = this.byId("cbCentro").getSelectedKey();
      if (!sCentroId) return sap.m.MessageBox.warning("Selecione o centro.");

      const oModel = this.getView().getModel();

      // 👇 ACTION via operation binding (POST)
      const oOp = oModel.bindContext("/listarVeiculosDisponiveis(...)");
      oOp.setParameter("centroId", sCentroId);

      await oOp.execute();
      const res = await oOp.requestObject();

      // CAP + UI5 podem devolver array direto ou { value: [...] }
      const aVeiculos = Array.isArray(res) ? res : (res && res.value) ? res.value : [];

      this.getView().setModel(new sap.ui.model.json.JSONModel({ veiculos: aVeiculos }), "vmVeic");
      this._dlgVeiculo.open();
    },


    onCancelarDialogVeiculo: function () {
      this._dlgVeiculo.close();
    },

    onConfirmarVeiculo: async function () {
      const sFragId = this.getView().getId();
      const oDlg = sap.ui.core.Fragment.byId(sFragId, "dlgSelecionarVeiculo");
      const cb = sap.ui.core.Fragment.byId(sFragId, "cbVeiculos");
      const veiculoId = cb.getSelectedKey();
      if (!veiculoId) return sap.m.MessageBox.warning("Escolha um caminhão.");

      const aIds = this._oSelecionados.map(p => p.pedidoID);
      const oModel = this.getView().getModel();

      oDlg?.setBusy(true);

      const oCtx = oModel.bindContext("/selecionarPedidosParaVeiculo(...)", null, {
        $$groupId: "$direct"         // 👈 evita $batch
      })
        .setParameter("veiculoId", veiculoId)
        .setParameter("pedidos", aIds);

      try {
        await oCtx.execute();
        const res = await oCtx.requestObject();
        if (!res?.success) throw new Error(res?.message || "Falha na seleção");
        this._aposSelecionarOk(res, oDlg, oModel, sFragId, aIds.length);
      } catch (e) {
        // tenta “salvar” se o backend respondeu sucesso mesmo com reject do execute()
        let resRec;
        try { resRec = await oCtx.requestObject(); } catch (_) { }
        if (resRec?.success) {
          this._aposSelecionarOk(resRec, oDlg, oModel, sFragId, aIds.length);
        } else {
          console.error("[selecionarPedidos] erro:", e);
          sap.m.MessageBox.error(resRec?.message || e?.message || "Erro inesperado ao selecionar pedidos.");
        }
      } finally {
        oDlg?.setBusy(false);
      }
    },

    _aposSelecionarOk: function (res, oDlg, oModel, sFragId, qtd) {
      sap.m.MessageToast.show(
        `Pedidos alocados! • Selecionados: ${res.selecionados ?? qtd}` +
        (res.rejeitados ? ` • Com falha: ${res.rejeitados}` : "") +
        (Number.isFinite(res.capacidadeRestante) ? ` • Livre: ${res.capacidadeRestante}` : ""),
        { duration: 2500 }
      );

      this._oSelecionados = [];
      this.getView().getModel("selecao")?.setProperty("/selectedKeys", {});
      oDlg?.close();
      this._oFragmentAgrupamento?.close();

      oModel.refresh();
      sap.ui.core.Fragment.byId(sFragId, "tblPedidosParaAgrupar")?.getBinding("items")?.refresh();
    },



    onIrVeiculos: function () {
      this.getOwnerComponent().getRouter().navTo("RouteViewVeiculos");
    },

    onAtualizarPedidos: function () {
            const oModel = this.getView().getModel(); // ODataModel V4
            if (oModel && oModel.refresh) {
                oModel.refresh(); // força reload do back
            }

            // Limpa seleção atual
            const oViewModel = this.getView().getModel("vmSel");
            if (oViewModel) {
                oViewModel.setData({}); // limpa detalhe
            }

            sap.m.MessageToast.show("Lista de veículos atualizada!");
        }

  });
});
