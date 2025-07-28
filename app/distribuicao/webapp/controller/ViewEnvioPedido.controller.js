sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
  ], (Controller, MessageToast, MessageBox) => {
    "use strict";
  
    return Controller.extend("distribuicao.controller.ViewEnvioPedido", {
  
      /* ------------------------------------------------ */
      /* BOTÃO QUE DISPARA A ACTION                       */
      /* ------------------------------------------------ */
      onBotaoPress: async function () {
        const oModel   = this.getView().getModel();
        const sCep     = this.byId("inputCep").getValue();
        const sNumero  = this.byId("inputNumero").getValue();
        const sPedido  = "8d1a7f2d-8c2f-4c8c-bd70-0aabb81a7af9";
      
        try {
          const oAction = oModel.bindContext("/realizarEntrega(...)")
            .setParameter("pedidoID"  , sPedido)
            .setParameter("cepDestino", sCep)
            .setParameter("numero"    , sNumero);
      
          await oAction.execute();
          const oResult = await oAction.requestObject();
      
          /* --- se back retornou erro amigável --- */
          if (!oResult.success) {
            MessageBox.error(oResult.message || "Falha ao criar entrega.");
            return;                          // ✔️ não prossegue
          }
      
          /* --- sucesso --- */
          this._geometryEncoded = oResult.geometry;
          MessageToast.show(`🚚 ${oResult.message}`);
          this._drawMap();
      
        } catch (e) {
          // falha na chamada OData / rede
          MessageBox.error("Erro inesperado. Tente novamente mais tarde.");
          console.error("realizarEntrega:", e);   // log desenvolvedor
        }
      },

      _drawMap: function () {
        console.log("_drawMap chamado");
      
        if (!window.L || !window.polyline) {
          console.error("Leaflet ou polyline não carregados!");
          return;
        }
      
        if (!this._geometryEncoded) {
          console.warn("Sem geometry para desenhar");
          return;
        }
      
        /* decodifica e desenha */
        const latlngs = polyline.decode(this._geometryEncoded)
                                .map(([lat, lon]) => [lat, lon]);
      
        /* destrói mapa antigo se existir */
        if (this._leafletMap) this._leafletMap.remove();
      
        this._leafletMap = L.map("map").setView(latlngs[0], 13);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap"
        }).addTo(this._leafletMap);
      
        L.polyline(latlngs, { color: "blue" }).addTo(this._leafletMap);
      },

      onIrParaConsultar: function () {
        this.getOwnerComponent()
            .getRouter()
            .navTo("RouteViewConsultarEntrega");   
      }
    });
  });
  