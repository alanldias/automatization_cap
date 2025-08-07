sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], (Controller, MessageToast, MessageBox) => {
  "use strict";

  let oSimulador;
  let iEntAtual = 0;
  let simuladorPausado = false;
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
        this._horarioEntrega = oResult.horarioEntrega;

        this._drawMap();

        if (oResult.statusEntrega === "ENTREGUE") {
          this._showEntregaToast(this._horarioEntrega);
          return;
        }
        this._simularEntrega(this._aSteps);

      } catch (err) {
        MessageBox.error(err.message || "Erro inesperado");
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
      const oModel   = this.getView().getModel();
      const rastreio = this._aRastreios[iEntAtual];
    
      try {
        /* 1. Reagenda a entrega --------------------------------------- */
        const oCtx1 = oModel.bindContext("/atualizarStatusEntrega(...)")
          .setParameter("codigo",     rastreio)
          .setParameter("novoStatus", "REAGENDAR");
        await oCtx1.execute();
        const res1 = await oCtx1.requestObject();   // { success, horarioEntrega, pedidoID }
    
        if (!res1.success) throw new Error(res1.message || "Erro ao reagendar entrega");
        const pedidoID = res1.pedidoID;             // ← veio direto do backend
        if (!pedidoID)  throw new Error("PedidoID não retornado pela entrega");
    
        /* 2. Devolve o pedido para a fila ------------------------------ */
        const oCtx2 = oModel.bindContext("/atualizarStatusPedidos(...)")
          .setParameter("pedidos",    [pedidoID])   // precisa ser array
          .setParameter("novoStatus", "PRONTO");
        await oCtx2.execute();
        const res2 = await oCtx2.requestObject();
        if (!res2.success) throw new Error(res2.message || "Erro ao reverter status do pedido");
    
        MessageToast.show("Entrega reagendada. Pedido voltou para fila.");
    
        /* 3. Fecha popup e continua simulação ------------------------- */
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
    
        simuladorPausado = false;   // ▶️ retoma caminhão
    
      } catch (err) {
        MessageBox.error(err.message || "Erro ao reagendar entrega.");
      }
    },    
    
    onEntregadorFalha: function () {
      MessageBox.error("Entrega marcada como falha. Simulação encerrada.");
      this._oFragmentEntregador.close();
      if (oSimulador) clearInterval(oSimulador);
    },

    onClienteOk: async function () {
      this._oFragmentCliente.close();
    
      const oModel   = this.getView().getModel();
      const rastreio = this._aRastreios[iEntAtual];
    
      /* 1. Marca a entrega como ENTREGUE ------------------------------- */
      const oCtxEnt = oModel.bindContext("/atualizarStatusEntrega(...)")
        .setParameter("codigo",     rastreio)
        .setParameter("novoStatus", "ENTREGUE");
      await oCtxEnt.execute();
      const resEnt = await oCtxEnt.requestObject();   // { success, message, pedidoID }
      if (!resEnt.success) {
        sap.m.MessageBox.error(resEnt.message);
        return;
      }
      const pedidoID = resEnt.pedidoID;               // veio do backend
    
      /* 2. Marca o pedido como FINALIZADO ------------------------------ */
      if (pedidoID) {
        const oCtxPed = oModel.bindContext("/atualizarStatusPedidos(...)")
          .setParameter("pedidos",    [pedidoID])     // array de UUID
          .setParameter("novoStatus", "FINALIZADO");
        await oCtxPed.execute();
        const resPed = await oCtxPed.requestObject();
        if (!resPed.success) {
          sap.m.MessageBox.error(resPed.message || "Erro ao finalizar pedido");
          return;
        }
      }
    
      /* 3. Prossegue com a simulação ---------------------------------- */
      iEntAtual++;
      const nEnts = this._aRastreios.length;
    
      if (iEntAtual < nEnts) {
        await this._atualizarStatus(this._aRastreios[iEntAtual], "EM_TRANSITO");
        console.log("[SIM] Próximo rast.", this._aRastreios[iEntAtual], "EM_TRANSITO");
      } else {
        this._showEntregaToast("agora mesmo");
        console.log("[SIM] Todas as entregas concluídas!");
      }
    
      simuladorPausado = false;   // ▶️ retoma caminhão
    },    

    onClienteFalha: function () {
      MessageBox.error("O cliente informou um problema. Simulação encerrada.");
      this._oFragmentCliente.close();
      if (oSimulador) clearInterval(oSimulador);
    }

  });
});
