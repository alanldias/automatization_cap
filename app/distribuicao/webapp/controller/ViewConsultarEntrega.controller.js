sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox",

], (Controller, MessageToast, MessageBox) => {
  "use strict";

  let oSimulador = null;        // timer
  let iEntAtual = 0;            // índice da entrega atual
  let simuladorPausado = false; // pausa quando abre dialogs
  let entregasConfirmadas = new Set();

  return Controller.extend("distribuicao.controller.ViewConsultarEntrega", {

    onInit: function () {
      const oRouter = this.getOwnerComponent().getRouter();
      oRouter.getRoute("RouteViewConsultarEntrega")
        ?.attachPatternMatched(this._onRotaCarregada, this);
      oRouter.getRoute("RouteViewConsultarEntregaComCodigo")
        ?.attachPatternMatched(this._onRotaCarregada, this);
    },

    _onRotaCarregada: function (oEvent) {
      const sCodigo = oEvent.getParameter("arguments")?.codigo || "";
      this.byId("inputCodigo").setValue(sCodigo);
      if (sCodigo) this.onBotaoPress();
    },
    onBotaoPress: async function () {
      if (oSimulador) { clearInterval(oSimulador); oSimulador = null; }
      iEntAtual = 0;
      simuladorPausado = false;
      entregasConfirmadas.clear();
      const oModel = this.getView().getModel();
      const sCodigo = this.byId("inputCodigo").getValue().trim();

      try {
        const oCtx = oModel.bindContext("/rastrearEntrega(...)")
          .setParameter("codigo", sCodigo);
        await oCtx.execute();
        const oResult = await oCtx.requestObject();
        if (!oResult.success) throw new Error(oResult.message);

        this._codigoRastreio = sCodigo;
        this._geometryEncoded = oResult.geometry;
        this._aSteps = JSON.parse(oResult.etapasRota || "[]");
        this._aDestinos = JSON.parse(oResult.destinos || "[]");

        this._aRastreios = JSON.parse(oResult.sequenciaRastreios || "[]");
        if (!this._aRastreios.length && this._codigoRastreio) {
          this._aRastreios = [this._codigoRastreio];
        }

        this._horarioEntrega = oResult.horarioEntrega;

        this._drawMap();

        if (oResult.statusEntrega === "ENTREGUE") {
          this._showEntregaToast(this._horarioEntrega);
          return;
        }
        this._simularEntrega(this._aSteps);

      } catch (err) {
        sap.m.MessageBox.error(err.message || "Erro inesperado");
      }
    },

    _drawMap: function () {
      if (!window.L || !window.polyline || !this._geometryEncoded) return;

      if ((!this._aDestinos || !this._aDestinos.length) && this._geometryEncoded) {
        const last = polyline.decode(this._geometryEncoded).slice(-1)[0];
        this._aDestinos = [last];
      }

      const aLatLngs = polyline.decode(this._geometryEncoded)
        .map(([lat, lon]) => [lat, lon]);

      if (this._leafletMap) { this._leafletMap.remove(); this._leafletMap = null; }

      const sMapId = "mapConsulta";
      const oDom = L.DomUtil.get(sMapId);
      if (oDom && oDom._leaflet_id) oDom._leaflet_id = null;

      this._leafletMap = L.map(sMapId).setView(aLatLngs[0], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap"
      }).addTo(this._leafletMap);

      L.polyline(aLatLngs, { color: "blue" }).addTo(this._leafletMap);
      this._leafletMap.fitBounds(aLatLngs);

      const oIconOrigem = L.icon({
        iconUrl: sap.ui.require.toUrl("distribuicao/img/warehouseicon.png"),
        iconSize: [32, 32], iconAnchor: [16, 32]
      });
      const oIconCasa = L.icon({
        iconUrl: sap.ui.require.toUrl("distribuicao/img/houseicon.png"),
        iconSize: [32, 32], iconAnchor: [16, 32]
      });

      L.marker(aLatLngs[0], { icon: oIconOrigem })
        .addTo(this._leafletMap).bindPopup("Origem");

      (this._aDestinos || []).forEach(([lat, lon], idx) => {
        L.marker([lat, lon], { icon: oIconCasa })
          .addTo(this._leafletMap).bindPopup(`Entrega ${idx + 1}`);
      });
    },

    _simularEntrega: async function (aSteps) {
      if (!this._aRastreios?.length && this._codigoRastreio) {
        this._aRastreios = [this._codigoRastreio];
      }

      if ((!this._aDestinos || !this._aDestinos.length) && this._geometryEncoded) {
        const last = polyline.decode(this._geometryEncoded).slice(-1)[0];
        this._aDestinos = [last];
      }

      if (!aSteps?.length || !this._aRastreios?.length) {
        console.warn("[SIM] Sem steps ou rastreios – abortado");
        return;
      }

      await this._atualizarStatus(this._aRastreios[0], "EM_TRANSITO");
      console.log("[SIM] Início – rastreio", this._aRastreios[0], "EM_TRANSITO");

      if (oSimulador) clearInterval(oSimulador);
      const aLatLngs = polyline.decode(this._geometryEncoded)
        .map(([lat, lon]) => [lat, lon]);

      const oIcon = L.icon({
        iconUrl: "img/truck.png", iconSize: [36, 36], iconAnchor: [18, 18]
      });
      const oMarker = L.marker(
        aLatLngs[aSteps[0].way_points[0]], { icon: oIcon }
      ).addTo(this._leafletMap);

      const dist = (c1, c2) => L.latLng(c1[0], c1[1]).distanceTo(L.latLng(c2[0], c2[1]));
      let iStep = 0;
      const nSteps = aSteps.length;
      const MAX_METROS = 50;

      oSimulador = setInterval(async () => {
        if (simuladorPausado ||
          (this._oFragmentEntregador?.isOpen() || this._oFragmentCliente?.isOpen())) return;

        if (iStep >= nSteps) {
          clearInterval(oSimulador);
          console.log("[SIM] terminou a rota, iStep>=nSteps");

          // tenta encerrar a rota pelo primeiro rastreio (mesmo veículo)
          await this._encerrarRota(this._aRastreios?.[0]);

          return;
        }

        const step = aSteps[iStep];
        const idxTarget = step.way_points[1];
        const coord = aLatLngs[idxTarget];
        const destAtual = this._aDestinos[iEntAtual];

        console.log(`[SIM] step ${iStep}/${nSteps - 1}  pos ${coord}  destino#${iEntAtual}`, destAtual);

        if (oMarker.slideTo) oMarker.slideTo(coord, { duration: 1000 });
        else oMarker.setLatLng(coord);

        MessageToast.show(`➡️ ${step.instruction}`, { duration: 1500 });

        if (destAtual && dist(coord, destAtual) <= MAX_METROS && !entregasConfirmadas.has(iEntAtual)) {
          console.log(`[SIM] >> Chegou na entrega ${iEntAtual + 1} dist=${dist(coord, destAtual).toFixed(1)} m`);
          simuladorPausado = true;
          entregasConfirmadas.add(iEntAtual);
          await this._mostrarFragmentEntregador(iEntAtual);
        }

        iStep++;
      }, 500);
    },

    _loadDialog: async function (propName, fragmentName) {
      if (!this[propName]) {
        this[propName] = await sap.ui.core.Fragment.load({
          id: this.getView().getId(),
          name: `distribuicao.view.Fragments.${fragmentName}`,
          controller: this
        });
        this.getView().addDependent(this[propName]);
      }
      return this[propName];
    },

    _mostrarFragmentEntregador: async function (iEnt) {
      this._entregaAtual = iEnt;
      const oDialog = await this._loadDialog("_oFragmentEntregador", "FragmentEntregador");
      oDialog.open();
      await new Promise(r => setTimeout(r, 200));
    },

    _mostrarFragmentCliente: async function (iEnt) {
      this._entregaAtual = iEnt;
      const oDialog = await this._loadDialog("_oFragmentCliente", "FragmentCliente");
      oDialog.open();
      await new Promise(r => setTimeout(r, 200));
    },

    _atualizarStatus: async function (sCodigo, sStatus) {
      const oModel = this.getView().getModel();
      try {
        const oCtx = oModel.bindContext("/atualizarStatusEntrega(...)")
          .setParameter("codigo", sCodigo)
          .setParameter("novoStatus", sStatus);
        await oCtx.execute();
        return await oCtx.requestObject();
      } catch (err) {
        console.warn("Falha ao atualizar status:", err.message);
        return null;
      }
    },

    _showEntregaToast: function (sPeriodoHora) {
      const txt = sPeriodoHora
        ? `✅ Pedido já foi entregue às ${sPeriodoHora}`
        : "✅ Entrega concluída!";
      MessageToast.show(txt, { duration: 4000 });
    },

    onEntregadorConfirmado: function () {
      MessageBox.confirm("Confirmar que o pedido foi entregue?", {
        onClose: async sAction => {
          if (sAction === "OK") {
            this._oFragmentEntregador.close();
            await this._mostrarFragmentCliente(this._entregaAtual);
          }
        }
      });
    },

    onEntregadorFalhaClienteNaoEstava: async function () {
      const oModel = this.getView().getModel();
      const rastreio = this._aRastreios?.[iEntAtual];
      if (!rastreio) {
        MessageBox.error("Código de rastreio não encontrado para esta entrega.");
        return;
      }

      const oCtx = oModel.bindContext("/reagendarEntrega(...)")
        .setParameter("codigo", rastreio);
      await oCtx.execute();
      const res = await oCtx.requestObject();

      if (!res.success) {
        MessageBox.error(res.message || "Erro ao reagendar entrega.");
        return;
      }

      MessageToast.show("Entrega reagendada. Pedido voltou para fila.");

      this._oFragmentEntregador.close();

      iEntAtual++;
      const nEnts = this._aRastreios.length;

      if (iEntAtual < nEnts) {
        await this._atualizarStatus(this._aRastreios[iEntAtual], "EM_TRANSITO");
        console.log("[SIM] Próximo rast.", this._aRastreios[iEntAtual], "EM_TRANSITO");
      } else {
        this._showEntregaToast("agora mesmo");
        console.log("[SIM] Todas as entregas concluídas!");
      }

      simuladorPausado = false;
    },

    // onEntregadorFalha: function () {
    //   MessageBox.error("Entrega marcada como falha. Simulação encerrada.");
    //   this._oFragmentEntregador.close();
    //   if (oSimulador) clearInterval(oSimulador);
    // },

    onClienteOk: async function () {
      this._oFragmentCliente.close();

      const rastreio = this._aRastreios?.[iEntAtual];
      if (!rastreio) {
        sap.m.MessageBox.error("Código de rastreio não encontrado para esta entrega.");
        return;
      }

      const oModel = this.getView().getModel();
      const oCtx = oModel.bindContext("/confirmarEntregaOk(...)")
        .setParameter("codigo", rastreio);
      await oCtx.execute();
      const res = await oCtx.requestObject();
      if (!res.success) {
        sap.m.MessageBox.error(res.message || "Erro ao confirmar entrega.");
        return;
      }

      iEntAtual++;
      const nEnts = this._aRastreios.length;
      if (iEntAtual < nEnts) {
        await this._atualizarStatus(this._aRastreios[iEntAtual], "EM_TRANSITO");
      } else {
        this._showEntregaToast(res.horarioEntrega || "agora mesmo");
      }
      simuladorPausado = false;
    },


    /**  Cliente reportou problema (pedido errado, quebrado, etc.) */
    onClienteFalha: async function (oEvent) {
      const oBtn = oEvent.getSource();
      const sTipo = oBtn.data("tipoOcorrencia");      // valor do CustomData
      const rastreio = this._aRastreios[iEntAtual];
      const oModel = this.getView().getModel();

      /* 1. Registra a ocorrência ------------------------------ */
      const oCtxOcc = oModel.bindContext("/registrarOcorrencia(...)")
        .setParameter("codigo", rastreio)
        .setParameter("tipo", sTipo)
        .setParameter("observacao", "");
      await oCtxOcc.execute();
      const resOcc = await oCtxOcc.requestObject();
      if (!resOcc.success) {
        sap.m.MessageBox.error(resOcc.message || "Erro ao registrar ocorrência.");
        return;
      }

      /* 2. Marca a entrega como FALHOU (se fizer sentido) ----- */
      await this._atualizarStatus(rastreio, "COM_PROBLEMAS")

      /* 3. Fecha o fragmento de cliente ----------------------- */
      this._oFragmentCliente.close();
      MessageToast.show("Ocorrência registrada – seguindo para a próxima entrega.");

      /* 4. Avança para a próxima entrega ---------------------- */
      iEntAtual++;
      const nEnts = this._aRastreios.length;

      if (iEntAtual < nEnts) {
        await this._atualizarStatus(this._aRastreios[iEntAtual], "EM_TRANSITO");
        console.log("[SIM] Próximo rast.", this._aRastreios[iEntAtual], "EM_TRANSITO");
      } else {
        this._showEntregaToast("rota encerrada (falha registrada)");
        console.log("[SIM] Todas as entregas concluídas / com ocorrências!");
      }

      simuladorPausado = false;        // ▶️ retoma o caminhão
    },
    _encerrarRota: async function (codigoRef) {
      if (!codigoRef) return;
      const oModel = this.getView().getModel();
      try {
        const oCtx = oModel.bindContext("/encerrarRotaDoVeiculo(...)")
          .setParameter("codigo", codigoRef);
        await oCtx.execute();
        const res = await oCtx.requestObject();
        if (!res.success) {
          console.warn("[SIM] encerrarRota:", res.message);
        } else {
          console.log("[SIM] Veículo liberado e pedidos limpos.");
          sap.m.MessageToast.show("Veículo liberado.");
        } F
      } catch (e) {
        console.warn("Falha ao encerrar rota:", e.message);
      }
    },





  });
});
