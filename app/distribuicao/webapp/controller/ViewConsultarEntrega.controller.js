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

      onBotaoPress: async function () {
        const oModel  = this.getView().getModel();
        const sCodigo = this.byId("inputCodigo").getValue().trim();
  
        if (!/^R\d{1,6}$/.test(sCodigo)) {
          MessageToast.show("Código de rastreio inválido. Use o formato R seguido de até 6 dígitos.");
          return;
        }
  
        try {
          const oAction = oModel.bindContext("/rastrearEntrega(...)")
                                .setParameter("codigo", sCodigo);
  
          await oAction.execute();
          const oResult = await oAction.requestObject();
          console.log(oResult,"resultado da action")
          if (!oResult.success) throw new Error(oResult.message);
  
          /* ---- guarda para uso posterior ---- */
          this._codigoRastreio  = sCodigo;
          this._geometryEncoded = oResult.geometry;
          this._aSteps = JSON.parse(oResult.etapasRota || "[]");
          this._horarioEntrega  = oResult.horarioEntrega;  // pode vir nulo
  
          /* desenha mapa */
          this._drawMap();
  
          /* ---------- já entregue? ---------- */
          if (oResult.statusEntrega === "Entregue") {
            this._showEntregaToast(this._horarioEntrega);
            return;                     // NÃO anima
          }
  
          /* ---------- ainda não entregue → anima ---------- */
          this._simularEntrega(this._aSteps);
  
        } catch (err) {
          MessageBox.error(err.message || "Erro inesperado");
        }
      },
  
      /* 2. Desenha rota (sem iniciar animação)                           */
      _drawMap: function () {
        if (!window.L || !window.polyline || !this._geometryEncoded) return;
      
        const aLatLngs = polyline.decode(this._geometryEncoded)
                                 .map(([lat, lon]) => [lat, lon]);
      
        if (this._leafletMap) { this._leafletMap.remove(); this._leafletMap = null; }
      
        const sMapId = "mapConsulta";
        const oDom   = L.DomUtil.get(sMapId);
        if (oDom && oDom._leaflet_id) oDom._leaflet_id = null;
      
        this._leafletMap = L.map(sMapId).setView(aLatLngs[0], 10);
      
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap"
        }).addTo(this._leafletMap);
      
        /* rota azul */
        L.polyline(aLatLngs, { color: "blue" }).addTo(this._leafletMap);
        this._leafletMap.fitBounds(aLatLngs);
      
        /* ---------- ícones personalizados ---------- */
        const oIconOrigem = L.icon({
          iconUrl   : sap.ui.require.toUrl("distribuicao/img/warehouseicon.png"),
          iconSize  : [32, 32],
          iconAnchor: [16, 32]
        });
      
        const oIconDestino = L.icon({
          iconUrl   : sap.ui.require.toUrl("distribuicao/img/houseicon.png"),
          iconSize  : [32, 32],
          iconAnchor: [16, 32]
        });
      
        /* markers de origem (primeira coordenada) err destino (última) */
        L.marker(aLatLngs[0], { icon: oIconOrigem })
          .addTo(this._leafletMap)
          .bindPopup("Origem");
      
        L.marker(aLatLngs[aLatLngs.length - 1], { icon: oIconDestino })
          .addTo(this._leafletMap)
          .bindPopup("Destino");
      },
  
      /* 3. Anima caminhão + atualiza status                              */
      _simularEntrega: async function (aSteps) {
        if (!aSteps?.length) return;
  
        /* ---- marca como EmTransito ---- */
        await this._atualizarStatus(this._codigoRastreio, "EM_TRANSITO");
  
        if (oSimulador) clearInterval(oSimulador);
  
        const aLatLngs = polyline.decode(this._geometryEncoded)
                                 .map(([lat, lon]) => [lat, lon]);
  
        const oIcon = L.icon({
          iconUrl   : "img/truck.png",
          iconSize  : [36, 36],
          iconAnchor: [18, 18]
        });
  
        const oMarker = L.marker(
          aLatLngs[aSteps[0].way_points[0]], { icon: oIcon }
        ).addTo(this._leafletMap);
  
        let iStep = 0;
        const n   = aSteps.length;
  
        oSimulador = setInterval(async () => {
          if (iStep >= n) {
            clearInterval(oSimulador);
  
            /* ---- marca Entregue err mostra horário ---- */
            const resp = await this._atualizarStatus(this._codigoRastreio, "ENTREGUE");
            this._showEntregaToast(resp?.horarioEntrega || "—:—");
  
            return;
          }
  
          const step      = aSteps[iStep];
          const idxTarget = step.way_points[1];
          const coord     = aLatLngs[idxTarget];
  
          if (oMarker.slideTo) { oMarker.slideTo(coord, { duration: 1000 }); }
          else                 { oMarker.setLatLng(coord); }
  
          MessageToast.show(`➡️ ${step.instruction}`, { duration: 1500 });
          iStep++;
        }, 3000);
      },
  
      /* 4. Action atualizarStatusEntrega                                 */
      _atualizarStatus: async function (sCodigo, sStatus) {
        const oModel = this.getView().getModel();
        try {
          const oCtx = oModel.bindContext("/atualizarStatusEntrega(...)")
                             .setParameter("codigo",     sCodigo)
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
  