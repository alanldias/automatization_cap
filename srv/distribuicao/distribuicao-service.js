const buscarEndereco = require('./utils/buscarEndereco');
const buscarCoords = require('./utils/buscarCoordenadas');
const calcularRota = require('./utils/calcularRotasORS');
const selecionarVeiculoEcd = require('./utils/selecionarVeiculo');
const cds = require('@sap/cds');

module.exports = async function (srv) {
  const { Entrega, Veiculo, PedidosProntosEntrega } = srv.entities;

  const PERIOD = h => (h >= 8 && h < 12) ? 'Manha' : (h >= 12 && h < 18) ? 'Tarde' : 'Noite';

  // ---------- ACTION criar -----------
  srv.on("realizarEntrega", async req => {
    const tx = cds.tx(req);
    let { pedidos } = req.data;

  // 2️⃣ caso não haja array ⇒ tenta o formato “antigo” OU o formato via rota
  if (!Array.isArray(pedidos)) {
    const {
      pedidoID,             // chamado diretamente pela UI5 em versões antigas
      codigo,               // vindo da rota (envio-pedido/.../:codigo/:cep/:numero)
      cepDestino,           // versão antiga
      cep,                  // versão atual
      numero
    } = req.data;

    const idPedido = pedidoID || codigo;        // aceita qualquer um
    const cepFinal = cepDestino || cep;         // idem

    if (idPedido && cepFinal) {
      pedidos = [{
        pedidoID: idPedido,
        cep     : cepFinal,
        numero  : numero || "S/N"
      }];
    }
  }

  // 3️⃣ valida
  if (!Array.isArray(pedidos) || pedidos.length === 0) {
    return { success: false, message: "Nenhum pedido informado." };
  }

    /** ---------------------------------------------------------------
     * 1. Descobre o Estado (UF) de cada pedido – evita chamadas repetidas
     * -------------------------------------------------------------- */
    const cacheCEP = new Map();
    const pedidosComUF = [];
    for (const p of pedidos) {
      if (!cacheCEP.has(p.cep)) {
        const end = await buscarEndereco(p.cep);      // ViaCEP
        cacheCEP.set(p.cep, end.estado);              // ex.: "PR"
      }
      pedidosComUF.push({ ...p, estado: cacheCEP.get(p.cep) });
    }

    /** ---------------------------------------------------------------
     * 2. Agrupa pedidos por estado – um CD por UF
     * -------------------------------------------------------------- */
    const gruposPorUF = {};
    for (const p of pedidosComUF) {
      (gruposPorUF[p.estado] ||= []).push(p);
    }

    const respostas = [];

    /** ---------------------------------------------------------------
     * 3. Processa cada estado separadamente
     * -------------------------------------------------------------- */
    for (const [estado, lista] of Object.entries(gruposPorUF)) {

      // Seleciona o CD e o veículo adequados para essa UF
      const selecao = await selecionarVeiculoEcd(estado);
      if (!selecao) {
        respostas.push({ success: false, message: `Nenhum veículo disponível em ${estado}` });
        continue;
      }
      const { veiculo, cd } = selecao;

      /* ---------- 3.1 Apenas 1 pedido ⇒ rota simples ---------- */
      if (lista.length === 1) {
        const { pedidoID, cep, numero } = lista[0];

        const end = await buscarEndereco(cep);
        const destino = await buscarCoords(`${end.rua} ${numero}, ${end.cidade}, ${end.estado}, ${cep}`);
        const origem = cd.lat
          ? { lat: cd.lat, lon: cd.lon }
          : await buscarCoords(`${cd.endereco}, ${cd.cidade}, ${cd.estado}`);

        const { distanceKm, geometry, steps } = await calcularRota(origem, destino);
        const rastreio = `R${Math.trunc(Math.random() * 1_000_000)}`;

        await tx.run(INSERT.into(Entrega).entries({
          pedidoID,
          clienteNome: "Cliente Simulado",
          cepDestino: cep,
          cidadeDestino: end.cidade,
          estadoDestino: end.estado,
          enderecoCompleto: end.enderecoCompleto,
          distanciaKm: distanceKm,
          rotaGeometry: geometry,
          etapasRota: JSON.stringify(steps),
          transportadora: cd.nome,
          rastreio,
          statusEntrega: "CRIADA",
          dataEnvio: new Date(),
          veiculo_ID: veiculo.ID,
          centroDistribuicao_ID: cd.ID
        }));

        await tx.run(UPDATE(Veiculo).set({ emUso: true, status: "EmRota" }).where({ ID: veiculo.ID }));

        respostas.push({
          success: true,
          message: `Entrega criada a partir do CD ${cd.nome}`,
          geometry,
          steps,
          rastreio
        });
        continue;
      }

      /* ---------- 3.2 Vários pedidos ⇒ rota múltipla otimizada ---------- */
      const calcularRotaMultipla = require("./utils/calcularRotaMultipla");
      const resultado = await calcularRotaMultipla(lista, cd);
      if (!resultado.success) {
        respostas.push(resultado);
        continue;
      }

      console.log("retorno do multiplo", resultado)

      const rastreioBase = `R${Math.trunc(Math.random() * 1_000_000)}`;
      const rastreioCodes = resultado.pedidosOrdenados
                       .map(p => `${rastreioBase}-${p.pedidoID}`);


      for (const [idx, p] of resultado.pedidosOrdenados.entries()) {
    await tx.run(INSERT.into(Entrega).entries({
          pedidoID: p.pedidoID,
          clienteNome: "Cliente Simulado",
          cepDestino: p.cep || "MULTIPONTO",
          cidadeDestino: "-",
          estadoDestino: estado,
          enderecoCompleto: "-",
          distanciaKm: "-",          // opcional: calc total
          rotaGeometry: resultado.geometry,
          etapasRota: JSON.stringify(resultado.steps),
          destinos: JSON.stringify(resultado.destinos),
          transportadora: cd.nome,
          sequenciaRastreios: JSON.stringify(rastreioCodes),   // 👈 grava array
          rastreio        : rastreioCodes[idx],
          statusEntrega: "CRIADA",
          dataEnvio: new Date(),
          veiculo_ID: veiculo.ID,
          centroDistribuicao_ID: cd.ID
        }));
      }

      await tx.run(UPDATE(Veiculo).set({ emUso: true, status: "EmRota" }).where({ ID: veiculo.ID }));

      respostas.push({
        success: true,
        message: `Entregas (${lista.length}) criadas a partir do CD ${cd.nome} (rota otimizada)`,
        geometry: resultado.geometry,
        steps: resultado.steps
      });
    } // fim loop estados

    /** ---------------------------------------------------------------
     * 4. Retorno consolidado
     * -------------------------------------------------------------- */
    return respostas.length === 1
      ? respostas[0]                       // só um estado
      : { success: true, resultados: respostas };
  });

  // ---------- ACTION rastrear -----------
  srv.on('rastrearEntrega', async ({ data: { codigo } }) => {
    const entrega = await SELECT.one.from(Entrega).where({ rastreio: codigo });
    if (!entrega) return { success: false, message: 'Código não encontrado' };

    return {
      success: true,
      message: 'Dados encontrados',
      geometry: entrega.rotaGeometry,
      etapasRota: entrega.etapasRota,
      destinos      : entrega.destinos,
      sequenciaRastreios: entrega.sequenciaRastreios,
      statusEntrega: entrega.statusEntrega,
      horarioEntrega: entrega.horarioEntrega,
      distanciaKm: entrega.distanciaKm
    };
  });

  // ---------- ACTION atualizar -----------
  srv.on('atualizarStatusEntrega', async req => {
    const { codigo, novoStatus } = req.data;
    const tx = cds.tx(req);

    const entrega = await tx.run(SELECT.one.from(Entrega).where({ rastreio: codigo }));
    if (!entrega) return { success: false, message: 'Código não encontrado' };

    let horarioEntrega = entrega.horarioEntrega;
    if (novoStatus === 'ENTREGUE' && !horarioEntrega) {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      horarioEntrega = `${PERIOD(now.getHours())}-${h}:${m}`;

      // ✅ Deixa o veículo disponível novamente
      await tx.run(
        UPDATE(Veiculo)
          .set({ emUso: false, status: "Disponivel" })
          .where({ ID: entrega.veiculo_ID })
      );
    }
    await tx.run(
      UPDATE(Entrega).set({
        statusEntrega: novoStatus,
        horarioEntrega
      }).where({ ID: entrega.ID })
    );

    return {
      success: true,
      message: `Status alterado para ${novoStatus}`,
      horarioEntrega,
      pedidoID       : entrega.pedidoID        
    };
  });


  srv.on('atualizarStatusPedidos', async req => {
    const { pedidos, novoStatus } = req.data;
    const tx = cds.tx(req);
  
    if (!pedidos || pedidos.length === 0) {
      return { success: false, message: 'Nenhum pedido fornecido.', atualizados: 0 };
    }
  
    const result = await tx.run(
      UPDATE(PedidosProntosEntrega)
        .set({ status: novoStatus }) // 👈 agora é dinâmico
        .where({ pedidoID: { in: pedidos } })
    );
  
    return {
      success: true,
      message: `${result} pedido(s) atualizado(s) para ${novoStatus}.`,
      atualizados: result
    };
  });
  
  

};
