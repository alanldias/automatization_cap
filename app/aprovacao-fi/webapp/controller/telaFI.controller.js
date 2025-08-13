sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/Dialog",
    "sap/m/TextArea",
    "sap/m/Button",
    "sap/m/Label",
], function (
    Controller,
    MessageToast,
    MessageBox,
    SelectDialog,
    StandardListItem,
    Filter,
    FilterOperator,
    Dialog,
    TextArea,
    Button,
    Label
) {
    "use strict";

    return Controller.extend("telaaprovacaofi.aprovacaofi.controller.telaFI", {

        // ========= Helpers =========
        _tblA: function () { return this.byId("tableOPAguard"); },
        _tblN: function () { return this.byId("tableOPNegada"); },

        _ctxA: function () {
            const it = this._tblA().getSelectedItem();
            return it ? it.getBindingContext() : null;
        },
        _ctxN: function () {
            const it = this._tblN().getSelectedItem();
            return it ? it.getBindingContext() : null;
        },

        _idA: function () { const c = this._ctxA(); return c ? c.getProperty("ID") : null; },
        _idN: function () { const c = this._ctxN(); return c ? c.getProperty("ID") : null; },

        _refreshAll: function () {
            const a = this._tblA().getBinding("items");
            const n = this._tblN().getBinding("items");
            a && a.refresh();
            n && n.refresh();
        },

        _postJSON: function (url, payload) {
            return new Promise(function (resolve, reject) {
                jQuery.ajax({
                    url,
                    method: "POST",
                    contentType: "application/json",
                    data: JSON.stringify(payload || {}),
                    success: resolve,
                    error: function (xhr) {
                        let msg = xhr && xhr.responseText ? xhr.responseText : "Erro na chamada";
                        reject(msg);
                    }
                });
            });
        },

        // helper opcional (coloque junto dos outros helpers)
        _patchJSON: function (url, payload) {
            return new Promise(function (resolve, reject) {
                jQuery.ajax({
                    url,
                    method: "PATCH",
                    contentType: "application/json",
                    data: JSON.stringify(payload || {}),
                    success: resolve,
                    error: function (xhr) {
                        let msg = xhr && xhr.responseText ? xhr.responseText : "Erro na atualização";
                        reject(msg);
                    }
                });
            });
        },


        onRefresh: function () { this._refreshAll(); MessageToast.show("Listas atualizadas"); },

        // seleção por clique na linha
        onRowPressAguard: function (e) { this._tblA().setSelectedItem(e.getSource()); },
        onRowPressNegada: function (e) { this._tblN().setSelectedItem(e.getSource()); },

        // ========= Vincular CC (ambas as tabelas) =========
        _openVincularCCDialog: function (ordemProducao_ID) {
            const that = this;

            const oDialog = new SelectDialog({
                title: "Selecionar Centro de Custo (apenas aprovados)",
                search: function (oEvt) {
                    const sValue = oEvt.getParameter("value");
                    const oBinding = oEvt.getSource().getBinding("items");
                    const aFilters = sValue ? [new Filter("nome", FilterOperator.Contains, sValue)] : [];
                    oBinding.filter(aFilters);
                },
                confirm: function (oEvt) {
                    const oSel = oEvt.getParameter("selectedItem");
                    if (!oSel) return;
                    const ccId = oSel.getBindingContext().getProperty("ID");

                    that._postJSON("/odata/v4/mm/vincularCentroCusto", {
                        ordemProducao_ID, centroCusto_ID: ccId
                    }).then(function () {
                        MessageToast.show("Centro de Custo vinculado.");
                        that._refreshAll();
                    }).catch(function (err) {
                        MessageBox.error(err);
                    });
                }
            });

            oDialog.bindAggregation("items", {
                path: "/CentroCusto",
                parameters: {
                    $select: "ID,nome,aprovado",
                    $orderby: "nome asc",
                    $filter: "aprovado eq true"
                },
                template: new StandardListItem({
                    title: "{nome}",
                    description: "{ID}"
                })
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        onVincularCC_Aguard: function () {
            const id = this._idA();
            if (!id) return MessageToast.show("Selecione uma OP em 'Aguardando aprovação'.");
            this._openVincularCCDialog(id);
        },

        onVincularCC_Negada: function () {
            const id = this._idN();
            if (!id) return MessageToast.show("Selecione uma OP em 'Negadas'.");
            this._openVincularCCDialog(id);
        },

        // ========= Aprovar / Negar =========
        onAprovar_Aguard: function () {
            const id = this._idA();
            if (!id) return MessageToast.show("Selecione uma OP em 'Aguardando aprovação'.");
            this._postJSON("/odata/v4/mm/aprovarOrdemProducao", {
                ordemProducao_ID: id, aprovado: true
            }).then(() => {
                MessageToast.show("OP aprovada.");
                this._refreshAll();
            }).catch(err => MessageBox.error(err));
        },

        onNegar_Aguard: function () {
            const id = this._idA();
            if (!id) return MessageToast.show("Selecione uma OP em 'Aguardando aprovação'.");

            const oTA = new TextArea({ width: "100%", rows: 4, placeholder: "Motivo da negação..." });
            const oDlg = new Dialog({
                title: "Negar OP",
                contentWidth: "30rem",
                content: [new Label({ text: "Informe o motivo:" }), oTA],
                beginButton: new Button({
                    text: "Negar", type: "Reject",
                    press: () => {
                        const motivo = oTA.getValue() || "Negado por FI";
                        this._postJSON("/odata/v4/mm/aprovarOrdemProducao", {
                            ordemProducao_ID: id, aprovado: false, motivo
                        }).then(() => {
                            MessageToast.show("OP negada.");
                            oDlg.close();
                            this._refreshAll();
                        }).catch(err => MessageBox.error(err));
                    }
                }),
                endButton: new Button({ text: "Cancelar", press: () => oDlg.close() }),
                afterClose: () => oDlg.destroy()
            });

            this.getView().addDependent(oDlg);
            oDlg.open();
        },

        onRever_Negada: function () {
            const id = this._idN();
            if (!id) return sap.m.MessageToast.show("Selecione uma OP em 'Negadas'.");

            // PATCH direto na entidade OrdensProducao
            this._patchJSON(`/odata/v4/mm/OrdensProducao(${id})`, {
                status: "aguardando_aprovacao"
                // opcional: você pode limpar ou manter o motivo. Para limpar:
                // motivo: null
            }).then(() => {
                sap.m.MessageToast.show("OP movida para 'Aguardando aprovação'.");
                this._refreshAll();
            }).catch(err => sap.m.MessageBox.error(err));
        },


    });
});
