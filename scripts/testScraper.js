const { scrapeAirbnb } = require('./marketScraper');

// URL de prueba proporcionada por Juan (White Sands)
const testUrl = "https://www.airbnb.mx/rooms/49911941?guests=1&adults=1";

async function run() {
  console.log("--- INICIANDO TEST DE SCRAPER STAYHOST ---");
  const data = await scrapeAirbnb(testUrl);
  
  if (data) {
    console.log("\n¡ÉXITO! Datos recolectados:");
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log("\nERROR: No se pudieron extraer datos. Revisa la conexión o los selectores.");
  }
}

run();
