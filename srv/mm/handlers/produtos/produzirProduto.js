const cds = require('@sap/cds');
const produzirCore = require('../shared/produzirCore');


module.exports = async function (req) {
  const { produto_ID, quantidade } = req.data;
  const tx = cds.transaction(req);

  const res = await produzirCore(tx, { produto_ID, quantidade, req });
  return res.ok; 
};
