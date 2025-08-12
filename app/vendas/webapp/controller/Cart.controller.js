sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (Controller, MessageToast, JSONModel, MessageBox, Filter, FilterOperator) {
  "use strict";

  const DEBUG = true;
  function log(...a) { if (DEBUG) console.log("[CART]", ...a); }

  return Controller.extend("vendas.controller.Cart", {

    onInit: function () {
      log("onInit start");

      // ViewModel do rodapé
      const oViewModel = new JSONModel({
        totalCarrinho: "Total: R$ 0,00",
        busyCheckout: false
      });
      this.getView().setModel(oViewModel, "view");

      // EventBus para recalcular quando catálogo alterar o carrinho
      sap.ui.getCore().getEventBus()
        .subscribe("CartChannel", "CartUpdated", this._onCartUpdated, this);

      const oList = this.byId("cartList");
      if (oList) {
        // 1) updateFinished da List (dispara quando os itens atualizam)
        oList.attachEvent("updateFinished", () => {
          log("List updateFinished → recalcular total");
          this._atualizarTotal();
        });

        // 2) quando o binding de items finalmente existir, ligamos dataReceived
        oList.attachEventOnce("modelContextChange", () => {
          const oBinding = oList.getBinding("items");
          log("modelContextChange → binding criado?", !!oBinding);
          if (oBinding) {
            oBinding.attachDataReceived((e) => {
              log("items.dataReceived fired", e && e.getParameters ? e.getParameters() : e);
              this._atualizarTotal();
            });
          }
        });
      } else {
        log("cartList NOT found in view");
      }

      // 3) aguardar o ODataModel ficar disponível e só então calcular
      this.getView().attachModelContextChange(() => {
        const oModel = this.getOwnerComponent().getModel(); // default model do componente
        if (oModel && !this._modelReady) {
          this._modelReady = true;
          log("ODataModel agora está disponível → primeira chamada do total");
          this._atualizarTotal();
        }
      });

      // Caso o model já esteja pronto agora, dispara já
      const oMaybeModel = this.getOwnerComponent().getModel();
      if (oMaybeModel) {
        this._modelReady = true;
        this._atualizarTotal();
      }
    },

    _onCartUpdated: function () {
      log("_onCartUpdated received from EventBus");
      const oList = this.byId("cartList");
      if (oList) {
        const oBinding = oList.getBinding("items");
        if (oBinding) {
          log("Refreshing list binding after CartUpdated");
          oBinding.refresh();
        }
      }
      this._atualizarTotal();
    },

    onNavBack: function () {
      this.getOwnerComponent().getRouter().navTo("RouteCatalogo", {}, true);
    },

    /** ======== Fallback local: soma do que estiver carregado na list ======== */
    /** ======== Fallback: soma local do que está carregado (sem usar propriedade 'total') ======== */
    /** ======== Fallback: soma local do que está carregado (sem usar propriedade 'total') ======== */
    _atualizarTotalAPartirDaLista: function () {
      console.log("[CART] _atualizarTotalAPartirDaLista (fallback) IN");
      const oList = this.byId("cartList");
      if (!oList) { console.log("[CART] No list, abort fallback"); return; }

      const oBinding = oList.getBinding("items");
      if (!oBinding) { console.log("[CART] No binding, abort fallback"); return; }

      const aCtxAll = oBinding.getCurrentContexts ? oBinding.getCurrentContexts() : [];
      const aCtx = aCtxAll.filter(Boolean); // evita undefined
      console.log("[CART] Current contexts length:", aCtx.length, "(raw:", aCtxAll.length, ")");

      const valores = [];
      const total = aCtx.reduce((acc, ctx) => {
        const pu = Number(ctx.getProperty("precoUnitario") || 0);
        const q = Number(ctx.getProperty("quantidade") || 0);
        const v = pu * q;
        valores.push(v);
        return acc + v;
      }, 0);

      console.log("[CART] Valores somados (visíveis):", valores, "TOTAL local:", total);
      const sBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total);
      this.getView().getModel("view").setProperty("/totalCarrinho", `Total: ${sBRL}`);
    }
    ,


    onRemoveFromCart: function (oEvent) {
      const oItem = oEvent.getSource().getBindingContext().getObject();
      const oModel = this.getOwnerComponent().getModel(); // use o model do componente
      const oList = this.byId("cartList");
      log("onRemoveFromCart item:", oItem);

      oModel.bindContext(`/removeFromCart(...)`)
        .setParameter("itemID", oItem.ID)
        .execute()
        .then(() => {
          MessageToast.show(`Item "${oItem.produto.nome}" removido do carrinho.`);
          if (oList) {
            const oBinding = oList.getBinding("items");
            if (oBinding) {
              log("Refresh after remove");
              oBinding.refresh();
            }
          }
          this._atualizarTotal();
        })
        .catch((err) => {
          console.error("[CART] removeFromCart error:", err);
          MessageToast.show("Erro ao remover item.");
        });
    },

    _isConflictMsg: function (err) {
      const m = (err && (err.message || err.toString())) || "";
      const code = err?.status || err?.httpStatus || err?.cause?.status || err?.error?.status;
      return (code === 409) || /409/i.test(m) || /Estoque insuficiente|Quantidade indisponível/i.test(m);
    },

    _parseShortages: function (sErr) {
      const out = [];
      if (!sErr) return out;
      const after = (sErr.split("Estoque insuficiente:")[1] || sErr).trim();
      after.split(";").forEach(chunk => {
        const c = chunk.trim();
        if (!c) return;
        const nameMatch = c.match(/^\s*([^()]+?)\s*\(/);
        const numsMatch = c.match(/\(\s*disp\.\s*([0-9]+)\s*,\s*faltam\s*([0-9]+)\s*\)/i);
        if (numsMatch) {
          out.push({
            nome: (nameMatch ? nameMatch[1] : "").trim(),
            disponivel: Number(numsMatch[1]),
            faltam: Number(numsMatch[2])
          });
        }
      });
      return out;
    },

    _formatShortageMsg: function (sErr) {
      const items = this._parseShortages(sErr);
      if (!items.length) return sErr || "Estoque insuficiente.";
      const linhas = items.map(i => `- ${i.nome}: Disponíveis ${i.disponivel} • Faltam ${i.faltam}`);
      return `Estoque insuficiente:\n${linhas.join("\n")}`;
    },

    onCheckout: function () {
      const oModel = this.getOwnerComponent().getModel();
      const usuario = "bia";
      const oPage = this.byId("cartPage");
      const setBusy = (b) => {
        this.getView().getModel("view").setProperty("/busyCheckout", !!b);
        if (oPage && oPage.setBusy) oPage.setBusy(!!b);
      };
      const callFinalize = (esperaProducao) => {
        return oModel
          .bindContext("/finalizarPedido(...)", undefined, { $$updateGroupId: "$auto" })
          .setParameter("usuario", usuario)
          .setParameter("esperaProducao", !!esperaProducao)
          .execute();
      };

      setBusy(true);
      callFinalize(false)
        .then((oCtxRet) => {
          const sMsg = (oCtxRet && oCtxRet.getBoundContext && oCtxRet.getBoundContext().getObject && oCtxRet.getBoundContext().getObject().value)
            || (typeof oCtxRet === "string" ? oCtxRet : null)
            || "Pedido criado!";
          MessageToast.show(sMsg);
          sap.ui.getCore().getEventBus().publish("CartChannel", "CartUpdated");
          this.getOwnerComponent().getRouter().navTo("Orders", {}, true);
        })
        .catch((err) => {
          const sErr = (err && (err.message || err.toString())) || "";
          const isConflict = this._isConflictMsg(err);
          if (isConflict) {
            const sNice = this._formatShortageMsg(sErr);
            MessageBox.confirm(
              `${sNice}\n\nDeseja aguardar o tempo de produção e mesmo assim finalizar?`,
              {
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: (sAction) => {
                  if (sAction === MessageBox.Action.YES) {
                    setBusy(true);
                    callFinalize(true)
                      .then((oCtxRet2) => {
                        const sMsg2 = (oCtxRet2 && oCtxRet2.getBoundContext && oCtxRet2.getBoundContext().getObject && oCtxRet2.getBoundContext().getObject().value)
                          || (typeof oCtxRet2 === "string" ? oCtxRet2 : null)
                          || "Pedido criado!";
                        MessageToast.show(sMsg2);
                        sap.ui.getCore().getEventBus().publish("CartChannel", "CartUpdated");
                        this.getOwnerComponent().getRouter().navTo("Orders", {}, true);
                      })
                      .catch((e2) => {
                        console.error("[CART] finalize with wait error:", e2);
                        MessageToast.show("Não foi possível finalizar o pedido.");
                      })
                      .finally(() => setBusy(false));
                  } else {
                    MessageToast.show("Pedido não finalizado.");
                    setBusy(false);
                  }
                }
              }
            );
          } else {
            console.error("[CART] finalize error:", err);
            MessageToast.show("Erro ao finalizar pedido.");
            setBusy(false);
          }
        });
    },

    /** ======== Cálculo “confiável” via OData $apply ======== */
    /** ======== Cálculo “confiável” via OData V4: $filter + $apply aggregate ======== */
    /** ======== Cálculo “confiável” via OData V4: $filter + $apply (compute+aggregate) ======== */
    _atualizarTotal: async function () {
      const oModel = this.getOwnerComponent().getModel(); // OData V4
      const oViewModel = this.getView().getModel("view");
      const usuario = "bia"; // TODO: usuário logado

      console.log("[CART] _atualizarTotal IN - user:", usuario);
      if (!oModel) {
        console.log("[CART] ODataModel ainda não disponível; abortando esta rodada");
        return;
      }

      try {
        // 1) Buscar o ID do carrinho do usuário (use Filter, sem $top nos params)
        const oCartList = oModel.bindList(
          "/Carrinho",
          null,
          null,
          [new sap.ui.model.Filter("usuario", sap.ui.model.FilterOperator.EQ, usuario)],
          { $select: "ID" }
        );
        const aCtx = await oCartList.requestContexts(0, 1);
        console.log("[CART] Cart contexts length:", aCtx.length);
        if (!aCtx.length) {
          oViewModel.setProperty("/totalCarrinho", "Total: R$ 0,00");
          return;
        }

        const cartId = aCtx[0].getProperty("ID");
        console.log("[CART] cartId:", cartId);

        // 2) Soma no servidor: subtotal = quantidade * precoUnitario; sum(subtotal) as valor
        const oAggList = oModel.bindList(
          "/CarrinhoItem",
          null,
          null,
          [new sap.ui.model.Filter("carrinho_ID", sap.ui.model.FilterOperator.EQ, cartId)],
          { $apply: "compute(quantidade mul precoUnitario as subtotal)/aggregate(subtotal with sum as valor)" }
        );
        const aAggCtx = await oAggList.requestContexts(0, 1);
        const oObj = aAggCtx.length ? aAggCtx[0].getObject() : null;
        console.log("[CART] Agg result object:", oObj);

        const nTotal = Number(oObj && (oObj.valor ?? 0));
        const sBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(nTotal);
        oViewModel.setProperty("/totalCarrinho", `Total: ${sBRL}`);
      } catch (e) {
        console.error("[CART] _atualizarTotal error:", e);
        // Fallback: soma local do que estiver carregado
        this._atualizarTotalAPartirDaLista();
      }
    }



  });
});
