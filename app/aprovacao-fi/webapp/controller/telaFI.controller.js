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
    "sap/m/Label"
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
        onInit: function () {
            this._iniciarAutoAtualizacaoTabela();
        },

        onExit: function () {
            if (this._intervalID) clearInterval(this._intervalID);
        },

        // Helpers já existentes
        _tblA: function () { return this.byId("tableOPAguard"); },
        _tblN: function () { return this.byId("tableOPNegada"); },

        _iniciarAutoAtualizacaoTabela: function () {
            // atualiza as DUAS tabelas de 10 em 10s
            this._intervalID = setInterval(() => {
                const tA = this._tblA();
                const tN = this._tblN();

                const bA = tA && tA.getBinding("items");
                const bN = tN && tN.getBinding("items");

                if (bA) bA.refresh();   // aguardando aprovação
                if (bN) bN.refresh();   // negadas
            }, 10000);
        },

        _refreshAll: function () {
            const bA = this._tblA() && this._tblA().getBinding("items");
            const bN = this._tblN() && this._tblN().getBinding("items");
            if (bA) bA.refresh();
            if (bN) bN.refresh();
        },

        // ========= Helpers =========
        _tblA: function () { return this.byId("tableOPAguard"); },
        _tblN: function () { return this.byId("tableOPNegada"); },

        _refreshAll: function () {
            const a = this._tblA() && this._tblA().getBinding("items");
            const n = this._tblN() && this._tblN().getBinding("items");
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


        // ========= Ações da UI =========
        onRefresh: function () { this._refreshAll(); MessageToast.show("Listas atualizadas"); },

        // (opcionais) ainda úteis caso queira destacar a linha ao clicar
        onRowPressAguard: function (e) { this._tblA() && this._tblA().setSelectedItem(e.getSource()); },
        onRowPressNegada: function (e) { this._tblN() && this._tblN().setSelectedItem(e.getSource()); },

        // ========= Vincular CC =========
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

        onVincularCC_Aguard: function (e) {
            const id = e.getSource().data("id");
            if (!id) return MessageToast.show("ID não encontrado nesta linha.");
            this._openVincularCCDialog(id);
        },

        // ========= Aprovar / Negar =========
        onAprovar_Aguard: function (e) {
            const id = e.getSource().data("id");
            if (!id) return MessageToast.show("ID não encontrado nesta linha.");
            this._postJSON("/odata/v4/mm/aprovarOrdemProducao", {
                ordemProducao_ID: id, aprovado: true
            }).then(() => {
                MessageToast.show("OP aprovada.");
                this._refreshAll();
            }).catch(err => MessageBox.error(err));
        },

        onNegar_Aguard: function (e) {
            const id = e.getSource().data("id");
            if (!id) return MessageToast.show("ID não encontrado nesta linha.");

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

        onRever_Negada: function (e) {
            const id = e.getSource().data("id");
            if (!id) return MessageToast.show("ID não encontrado nesta linha.");

            // PATCH direto na entidade. Se o seu CAP exige aspas no GUID, ajuste para `('"+id+"')`.
            this._patchJSON(`/odata/v4/mm/OrdensProducao(${id})`, {
                status: "aguardando_aprovacao"
                // , motivo: null // caso queira limpar
            }).then(() => {
                MessageToast.show("OP movida para 'Aguardando aprovação'.");
                this._refreshAll();
            }).catch(err => MessageBox.error(err));
        }

    });
});
