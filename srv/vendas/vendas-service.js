const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const { Clientes, Enderecos } = this.entities;

  this.before(['CREATE', 'UPDATE'], Clientes, async (req) => {
    const { nome, email, telefone, enderecos } = req.data;

    // ===== Validação do Cliente =====
    if (!nome || nome.trim() === '') {
      req.error(400, 'O campo "nome" do cliente é obrigatório.');
    }

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      req.error(400, 'O campo "email" do cliente é obrigatório e deve ser válido.');
    }

    if (!telefone || !/^\+?[0-9]{10,15}$/.test(telefone)) {
      req.error(400, 'O campo "telefone" é obrigatório e deve conter entre 10 e 15 dígitos.');
    }

    // ===== Validação dos Endereços =====
    if (enderecos && Array.isArray(enderecos)) {
      for (const [index, endereco] of enderecos.entries()) {
        const path = `enderecos[${index}]`;

        if (!endereco.tipo) {
          req.error(400, `O campo "tipo" é obrigatório em ${path}`);
        }

        if (!endereco.logradouro || endereco.logradouro.trim() === '') {
          req.error(400, `O campo "logradouro" é obrigatório em ${path}`);
        }

        if (!endereco.numero || endereco.numero.trim() === '') {
          req.error(400, `O campo "numero" é obrigatório em ${path}`);
        }


        if (!endereco.cep || !/^\d{8}$/.test(endereco.cep)) {
          req.error(400, `O campo "cep" deve conter 8 dígitos numéricos em ${path}`);
        }
      }
    }
  });
  this.before(['UPDATE', 'PATCH'], Enderecos, async (req) => {
    const { tipo, logradouro, numero, bairro, cidade, estado, cep } = req.data;

    if (!tipo || tipo.trim() === '') {
      req.error(400, 'O campo "tipo" é obrigatório.');
    }

    if (!logradouro || logradouro.trim() === '') {
      req.error(400, 'O campo "logradouro" é obrigatório.');
    }

    if (!numero || numero.trim() === '') {
      req.error(400, 'O campo "numero" é obrigatório.');
    }

    if (!cep || !/^\d{8}$/.test(cep)) {
      req.error(400, 'O campo "cep" deve conter exatamente 8 dígitos.');
    }
  });

});
