const XLSX = require('./temp_xlsx_env/node_modules/xlsx');
const path = "c:\\01ApplicactionCartoProduit\\storage\\documents\\produits\\Produit0_DEMO\\Fichier Paramétrage KELIA\\04 Fiche_parametrage_KELIA V1.xlsx";
const wb = XLSX.readFile(path);
console.log('Sheets:', JSON.stringify(wb.SheetNames));
wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
  console.log('\n=== Sheet: ' + name + ' (' + data.length + ' rows) ===');
  data.slice(0,10).forEach((row,i) => console.log('  Row ' + i + ': ' + JSON.stringify(row)));
});