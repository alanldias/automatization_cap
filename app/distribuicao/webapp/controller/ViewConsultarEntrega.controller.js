sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], (Controller, MessageToast, MessageBox) => {
  "use strict";

  let oSimulador;               // timer global

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
    /* 1. Botão “Consultar” — guarda destinos para o mapa                 */
    onBotaoPress: async function () {
      const oModel = this.getView().getModel();
      const sCodigo = this.byId("inputCodigo").getValue().trim();

      try {
        const oCtx = oModel.bindContext("/rastrearEntrega(...)")
          .setParameter("codigo", sCodigo);

        await oCtx.execute();
        const oResult = await oCtx.requestObject();
        if (!oResult.success) throw new Error(oResult.message);

        /* ---- guarda para uso posterior ---- */
        this._codigoRastreio = sCodigo;
        this._geometryEncoded = oResult.geometry;
        this._aSteps = JSON.parse(oResult.etapasRota || "[]");
        this._aDestinos = JSON.parse(oResult.destinos || "[]"); // 👈 novo
        this._aRastreios = JSON.parse(oResult.sequenciaRastreios || "[]");
        this._horarioEntrega = oResult.horarioEntrega;

        /* desenha mapa */
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
    /* 2. Desenha mapa — coloca ícones só nos destinos reais              */
    _drawMap: function () {
      if (!window.L || !window.polyline || !this._geometryEncoded) return;

      /* ---------- Fallback: garante pelo menos 1 destino ---------- */
      if ((!this._aDestinos || !this._aDestinos.length) && this._geometryEncoded) {
        const last = polyline.decode(this._geometryEncoded).slice(-1)[0]; // [lat,lon]
        this._aDestinos = [last];
      }
      /* ------------------------------------------------------------- */

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

      /* rota em azul */
      L.polyline(aLatLngs, { color: "blue" }).addTo(this._leafletMap);
      this._leafletMap.fitBounds(aLatLngs);

      /* ícones */
      const oIconOrigem = L.icon({
        iconUrl: sap.ui.require.toUrl("distribuicao/img/warehouseicon.png"),
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      });
      const oIconCasa = L.icon({
        iconUrl: sap.ui.require.toUrl("distribuicao/img/houseicon.png"),
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      });

      /* origem (primeiro ponto da polyline) */
      L.marker(aLatLngs[0], { icon: oIconOrigem })
        .addTo(this._leafletMap)
        .bindPopup("Origem");

      /* casas somente nos destinos reais */
      (this._aDestinos || []).forEach(([lat, lon], idx) => {
        L.marker([lat, lon], { icon: oIconCasa })
          .addTo(this._leafletMap)
          .bindPopup(`Entrega ${idx + 1}`);
      });
    },

    /* 3. Anima caminhão + atualiza status                              */
    _simularEntrega: async function (aSteps) {
      /* ---------------- Fallbacks para entrega única ---------------- */
      // a) rastreio: se vier vazio, usa _codigoRastreio
      if (!this._aRastreios || !this._aRastreios.length) {
        if (this._codigoRastreio) {
          this._aRastreios = [this._codigoRastreio];
        }
      }

      // b) destinos: se vier vazio, usa o último ponto da polyline
      if ((!this._aDestinos || !this._aDestinos.length) && this._geometryEncoded) {
        const last = polyline.decode(this._geometryEncoded).slice(-1)[0]; // [lat,lon]
        this._aDestinos = [last];
      }

      /* ---------------- Validações ---------------- */
      if (!aSteps?.length || !this._aRastreios?.length) {
        console.warn("[SIM] Sem steps ou rastreios – abortado");
        return;
      }

      /* 0. Primeira entrega já EM_TRANSITO */
      await this._atualizarStatus(this._aRastreios[0], "EM_TRANSITO");
      console.log("[SIM] Início – rastreio", this._aRastreios[0], "EM_TRANSITO");

      if (oSimulador) clearInterval(oSimulador);

      const aLatLngs = polyline.decode(this._geometryEncoded)
        .map(([lat, lon]) => [lat, lon]);   // [lat, lon]

      /* Caminhão */
      const oIcon = L.icon({
        iconUrl: "img/truck.png",
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      const oMarker = L.marker(
        aLatLngs[aSteps[0].way_points[0]],
        { icon: oIcon }
      ).addTo(this._leafletMap);

      let iStep = 0;
      let iEnt = 0;
      const nSteps = aSteps.length;
      const nEnts = this._aRastreios.length;
      const MAX_METROS = 50;                     // ≤ 30 m considera “chegou”

      /* Helper distância em metros */
      const dist = (c1, c2) => L.latLng(c1[0], c1[1]).distanceTo(L.latLng(c2[0], c2[1]));

      oSimulador = setInterval(async () => {
        if (iStep >= nSteps) {             // chegou ao fim da polyline
          clearInterval(oSimulador);
          console.log("[SIM] terminou a rota, iStep>=nSteps");
          return;
        }

        /* Move para próximo ponto */
        const step = aSteps[iStep];
        const idxTarget = step.way_points[1];
        const coord = aLatLngs[idxTarget];     // [lat, lon]
        const destAtual = this._aDestinos[iEnt];   // [lat, lon]

        console.log(`[SIM] step ${iStep}/${nSteps - 1}  pos ${coord}  destino#${iEnt}`, destAtual);

        if (oMarker.slideTo) oMarker.slideTo(coord, { duration: 1000 });
        else oMarker.setLatLng(coord);

        sap.m.MessageToast.show(`➡️ ${step.instruction}`, { duration: 1500 });

        /* Chegou? (≤ 30 m) */
        if (destAtual && dist(coord, destAtual) <= MAX_METROS) {
          console.log(`[SIM] >> Chegou na entrega ${iEnt + 1} dist=${dist(coord, destAtual).toFixed(1)} m`);

          /* 1. Marca ENTREGUE p/ rastreio corrente */
          await this._atualizarStatus(this._aRastreios[iEnt], "ENTREGUE");
          console.log("[SIM] Rast.", this._aRastreios[iEnt], "ENTREGUE");

          iEnt++;

          /* 2. Se tem mais, põe próxima em EM_TRANSITO */
          if (iEnt < nEnts) {
            await this._atualizarStatus(this._aRastreios[iEnt], "EM_TRANSITO");
            console.log("[SIM] Próximo rast.", this._aRastreios[iEnt], "EM_TRANSITO");
          } else {
            this._showEntregaToast("agora mesmo");
            console.log("[SIM] Todas as entregas concluídas!");
          }
        }

        iStep++;
      }, 500);
    },
    /* 4. Action atualizarStatusEntrega                                 */
    _atualizarStatus: async function (sCodigo, sStatus) {
      const oModel = this.getView().getModel();
      try {
        const oCtx = oModel.bindContext("/atualizarStatusEntrega(...)")
          .setParameter("codigo", sCodigo)
          .setParameter("novoStatus", sStatus);
        await oCtx.execute();
        return await oCtx.requestObject();   // { success, horarioEntrega, … }
      } catch (err) {
        console.warn("Falha ao atualizar status:", err.message);
        return null;
      }
    },

    /* 5. Toast de entrega concluída                                    */
    _showEntregaToast: function (sPeriodoHora) {
      const txt = sPeriodoHora
        ? `✅ Pedido já foi entregue às ${sPeriodoHora}`
        : "✅ Entrega concluída!";
      MessageToast.show(txt, { duration: 4000 });
    }

  });
});
