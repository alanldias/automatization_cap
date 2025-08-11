sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, MessageBox, MessageToast, JSONModel, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("distribuicao.controller.ViewVeiculos", {
        onInit: function () {
            this.getView().setModel(new JSONModel({
                ID: null,
                nome: "",
                placa: "",
                status: "",
                capacidade: 0,
                capacidadeAtual: 0,
                pedidos: []
            }), "vmSel");
        },

        // filtra veículos por centro (opcional)
        onCentroChange: function () {
            const sCentroId = this.byId("cbCentroVeic").getSelectedKey();
            const oList = this.byId("lstVeiculos");
            const oBinding = oList.getBinding("items");
            if (!oBinding) return;

            const aFilters = [];
            if (sCentroId) {
                aFilters.push(new Filter({
                    path: "centro_ID",
                    operator: FilterOperator.EQ,
                    value1: sCentroId,
                    valueType: "Edm.Guid"
                }));
            }
            // Ex.: para mostrar só Disponível/EmRota (descomente):
            // aFilters.push(new Filter({
            //   filters: [
            //     new Filter("status", FilterOperator.EQ, "Disponivel"),
            //     new Filter("status", FilterOperator.EQ, "EmRota")
            //   ],
            //   and: false
            // }));

            oBinding.filter(aFilters);
        },

        onVehicleSelect: async function (oEvent) {
            const oCtx = oEvent.getParameter("listItem").getBindingContext();
            const oVeic = await oCtx.requestObject(); // garante os campos do $select

            const oVM = this.getView().getModel("vmSel");
            // normaliza e injeta só o que precisa (evita undefined → 0/0 no header)
            oVM.setData({
                ID: oVeic.ID,
                nome: oVeic.nome,
                placa: oVeic.placa,
                status: oVeic.status,
                capacidade: Number(oVeic.capacidade ?? 0),
                capacidadeAtual: Number(oVeic.capacidadeAtual ?? 0),
                pedidos: [] // limpa até carregar
            });

            await this._carregarPedidosDoVeiculo(oVeic.ID);
        },

        _carregarPedidosDoVeiculo: async function (sVeiculoId) {
            const oModel = this.getView().getModel();

            const oList = oModel.bindList(
                "/PedidosProntosEntrega",
                null, null, null,
                {
                    // 👇 UM cifrão
                    $select: "pedidoID,clienteNome,cep,cidade,estado,status,veiculo_ID"
                }
            );

            oList.filter([
                new sap.ui.model.Filter({
                    path: "veiculo_ID",
                    operator: sap.ui.model.FilterOperator.EQ,
                    value1: sVeiculoId,
                    valueType: "Edm.Guid"      // 👈 importantíssimo pro GUID
                }),
                new sap.ui.model.Filter({
                    filters: [
                        new sap.ui.model.Filter("status", sap.ui.model.FilterOperator.EQ, "SELECIONADO"),
                        new sap.ui.model.Filter("status", sap.ui.model.FilterOperator.EQ, "ENVIADO")
                    ],
                    and: false                  // OR
                })
            ]);

            const aCtxs = await oList.requestContexts(0, 200);
            const aRows = await Promise.all(aCtxs.map(c => c.requestObject()));

            console.log("[VEIC] pedidos:", aRows.length, aRows);

            this.getView().getModel("vmSel").setProperty("/pedidos", aRows || []);
        },


        _bindPedidosVeiculo: function (sVeiculoId) {
            const oTbl = this.byId("tblPedidosVeiculo");

            // cria bind uma vez
            if (!oTbl.getBinding("items")) {
                oTbl.bindItems({
                    path: "/PedidosProntosEntrega",
                    template: oTbl.getItems()[0]?.clone() // ou recrie template se preferir
                });
            }

            const oBinding = oTbl.getBinding("items");
            if (!oBinding) return;

            const aFilters = [];
            if (sVeiculoId) {
                aFilters.push(new Filter({
                    path: "veiculo_ID",
                    operator: FilterOperator.EQ,
                    value1: sVeiculoId,
                    valueType: "Edm.Guid"
                }));
            }
            // mostrar apenas os que estão prontos para despachar
            aFilters.push(new Filter("status", FilterOperator.EQ, "SELECIONADO"));

            oBinding.filter(aFilters);
        },

        // botão Despachar (chama action quando o back estiver pronto)
        onDespachar: async function () {
            const oVM = this.getView().getModel("vmSel");
            const veiculoId = oVM.getProperty("/ID");
            if (!veiculoId) return sap.m.MessageBox.warning("Selecione um veículo.");

            const oPage = this.byId("pageVeiculos");
            const oModel = this.getView().getModel();

            oPage.setBusy(true);

            // executa fora do $batch (evita o 401 do geocoding ferrar o execute)
            const oCtx = oModel.bindContext("/despacharVeiculo(...)", null, { $$groupId: "$direct" })
                .setParameter("veiculoId", veiculoId);

            try {
                await oCtx.execute();

                // mesmo se cair no catch, tenta ler o payload
                let res;
                try { res = await oCtx.requestObject(); } catch (_) { }

                if (!res || res.success !== true) {
                    throw new Error(res?.message || "Falha ao despachar o veículo.");
                }

                sap.m.MessageToast.show(res.message || "Despachado com sucesso.");

                // Atualiza status visual do header (opcional)
                oVM.setProperty("/status", "EmRota");

                // refresh geral (veículos mudam status; pedidos saem de SELECIONADO)
                oModel.refresh();
                this.byId("lstVeiculos")?.getBinding("items")?.refresh();

                // Recarrega a tabela da direita:
                // Se você quer que desapareçam (mostrando só SELECIONADO), deixa o filtro só em SELECIONADO
                await this._carregarPedidosDoVeiculo(veiculoId);

            } catch (e) {
                console.error(e);
                sap.m.MessageBox.error(e.message || "Erro ao despachar veículo.");
            } finally {
                oPage.setBusy(false);
            }
        },

        // (opcional) para aplicar filtros fixos na lista de veículos
        _applyVehicleFilters: function () {
            const oBinding = this.byId("lstVeiculos").getBinding("items");
            if (!oBinding) return;

            const aFilters = [
                new Filter({
                    filters: [
                        new Filter("status", FilterOperator.EQ, "Disponivel"),
                        new Filter("status", FilterOperator.EQ, "EmRota")
                    ],
                    and: false
                })
            ];
            oBinding.filter(aFilters);
        }
    });
});
