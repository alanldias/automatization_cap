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
        const oModel = this.getView().getModel();
        const pedidoID   = "8d1a7f2d-8c2f-4c8c-bd70-0aabb81a7af9";
        // const cepDestino = "80410201"; //11080345 sp // 80410201 ntt cwb

        const cepDestino = this.byId("inputCep").getValue();
        const numero = this.byId("inputNumero").getValue();

  
        try {
          const oAction = oModel.bindContext("/realizarEntrega(...)")
            .setParameter("pedidoID",  pedidoID)
            .setParameter("cepDestino", cepDestino)
            .setParameter("numero", numero); // 👈 adiciona isso


          await oAction.execute();
          const oResult = await oAction.requestObject();
  
          /* supondo que o backend devolva tambem geometry */
          this._geometryEncoded = oResult.geometry;   // 👈 salva string

          console.log(oResult.geometry)
  
          MessageToast.show(`🚚 ${oResult.message}`);
          this._drawMap();                            // 👈 desenha
        } catch (e) {
          MessageBox.error(e.message);
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
      }
    });
  });
  