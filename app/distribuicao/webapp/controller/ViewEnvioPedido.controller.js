sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
  ], (Controller, MessageToast, MessageBox) => {
    "use strict";
  
    return Controller.extend("distribuicao.controller.ViewEnvioPedido", {

      onInit: function () {
        const oRouter = this.getOwnerComponent().getRouter();
      
        oRouter.getRoute("RouteViewEnvioPedido")
               ?.attachPatternMatched(this._onRotaCarregada, this);
      
        oRouter.getRoute("RouteViewEnvioPedidoComCodigo")
               ?.attachPatternMatched(this._onRotaCarregada, this);
      },
      
      _onRotaCarregada: function (oEvent) {
        const args = oEvent.getParameter("arguments") || {};

        console.log(args)
      
        this._pedidoID = args.codigo;
      
        if (!this._pedidoID) {
          MessageBox.error("Pedido não informado.");
          return;
        }
      
        if (args.cep) {
          this.byId("inputCep")?.setValue(args.cep);
        }
      
        if (args.numero) {
          this.byId("inputNumero")?.setValue(args.numero);
        }
      
        this.onBotaoPress(); // dispara ação automática
      },
  
       /* BOTÃO QUE DISPARA A ACTION                       */
      onBotaoPress: async function () {
        const oModel   = this.getView().getModel();
        const sCep     = this.byId("inputCep").getValue().trim();
        const sNumero  = this.byId("inputNumero").getValue().trim();
        const sPedido = this._pedidoID;
      
        // Validação do CEP
        if (!sCep || !/^\d{8}$/.test(sCep.replace(/\D/g, ""))) {
          sap.m.MessageToast.show("Informe um CEP válido com 8 dígitos.");
          return;
        }
      
        try {
          const oAction = oModel.bindContext("/realizarEntrega(...)")
          oAction.setParameter("pedidos", [{
            pedidoID : sPedido,
            cep      : sCep,
            numero   : sNumero              // pode estar vazio, se quiser
          }]);      
      
          await oAction.execute();
          const oResult = await oAction.requestObject();
      
          /* --- se back retornou erro amigável --- */
          if (!oResult.success) {
            MessageBox.error(oResult.message || "Falha ao criar entrega.");
            return;                          // ✔️ não prossegue
          }
      
          /* --- sucesso --- */
          this._geometryEncoded = oResult.geometry;
          MessageBox.success(
            `Entrega criada com sucesso!\n📦 Código de rastreio: ${oResult.rastreio}`,
            {
              title   : "Entrega criada",
              actions : ["Visualizar", "Fechar"],
              onClose : sAction => {
                if (sAction === "Visualizar") {
                  this._irParaConsultarComCodigo(oResult.rastreio);
                }
              }
            }
          );
          this._drawMap();
      
        } catch (err) {
          // falha na chamada OData / rede
          MessageBox.error("Erro inesperado. Tente novamente mais tarde.");
          console.error("realizarEntrega:", err);   // log desenvolvedor
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
      
        /* 1. Decode polyline */
        const latlngs = polyline
          .decode(this._geometryEncoded)       // [[lat, lon], ...]
          .map(([lat, lon]) => [lat, lon]);    // garante formato Leaflet
      
        /* 2. (Re)cria mapa */
        if (this._leafletMap) this._leafletMap.remove();   // limpa mapa antigo
        this._leafletMap = L.map("map").setView(latlngs[0], 13);
      
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap"
        }).addTo(this._leafletMap);
      
        /* 3. Desenha rota */
        L.polyline(latlngs, { color: "blue" }).addTo(this._leafletMap);
      
        /* 4. Ícones personalizados */
        const oIcon = L.icon({
          iconUrl : sap.ui.require.toUrl("distribuicao/img/warehouseicon.png"),
          iconSize: [32, 32],
          iconAnchor: [16, 32]     // base do pin no centro embaixo
        });
      
        const dIcon = L.icon({
          iconUrl : sap.ui.require.toUrl("distribuicao/img/houseicon.png"),
          iconSize: [32, 32],
          iconAnchor: [16, 32]
        });
      
        /* 5. Markers de origem err destino */
        L.marker(latlngs[0], { icon: oIcon }).addTo(this._leafletMap)
          .bindPopup("Origem");
      
        L.marker(latlngs[latlngs.length - 1], { icon: dIcon }).addTo(this._leafletMap)
          .bindPopup("Destino");
      },
      onIrParaConsultar: function () {
        this.getOwnerComponent()
            .getRouter()
            .navTo("RouteViewConsultarEntrega");   
      }, 

      _irParaConsultarComCodigo: function (sCodigo) {
        const oRouter = this.getOwnerComponent().getRouter();
        oRouter.navTo("RouteViewConsultarEntregaComCodigo", {
          codigo: sCodigo
        });
      }
    });
  });
  