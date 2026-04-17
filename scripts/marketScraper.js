/**
 * StayHost Market Intelligence Scraper (POC)
 * Este script utiliza Puppeteer para extraer datos competitivos de anuncios de Airbnb.
 * Se enfoca en la estrategia "Peras con Peras" para White Sands, Punta Cana.
 */

const puppeteer = require('puppeteer');

async function scrapeAirbnb(url) {
  console.log(`[StayHost Bot] Iniciando análisis de: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Nos hacemos pasar por un usuario real
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

    // Validamos y forzamos la moneda en dólares para evitar confusiones con MXN
    const usdUrl = url.includes('?') ? `${url}&currency=USD` : `${url}?currency=USD`;

    await page.goto(usdUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Esperamos a que cargue el precio
    await page.waitForSelector('span._1y62388', { timeout: 10000 }).catch(() => null);

    const data = await page.evaluate(() => {
      // Función auxiliar para buscar texto por patrón
      const findByText = (query) => {
        const elements = Array.from(document.querySelectorAll('span, button, div'));
        return elements.find(el => el.innerText.includes(query))?.innerText;
      };

      // Selectores dinámicos más inteligentes para el precio
      const priceCandidates = Array.from(document.querySelectorAll('span, div'))
        .filter(el => {
          const text = el.innerText;
          return text.includes('$') && text.length < 20 && /\d/.test(text);
        });

      // Preferimos el que tenga la palabra "noche" o "night" cerca en su contenedor principal
      const priceElement = priceCandidates.find(c => {
        const context = c.closest('div')?.innerText.toLowerCase() || "";
        return context.includes('noche') || context.includes('night');
      }) || priceCandidates[0];

      const ratingElement = document.querySelector('span._17p69ad') || 
                            document.querySelector('span._1h98063') || 
                            document.querySelector('[aria-label*="puntuación"]');

      const reviewsElement = document.querySelector('button._118063t') || 
                             document.querySelector('span._118063t') ||
                             Array.from(document.querySelectorAll('span, button')).find(s => s.innerText.toLowerCase().includes('reseña'));

      return {
        title: document.querySelector('h1')?.innerText || "Anuncio",
        price: priceElement?.innerText.replace(/[^0-9]/g, '') || "N/A",
        rating: ratingElement?.innerText.split(' ')[0] || "0",
        reviews: reviewsElement?.innerText.replace(/[^0-9]/g, '') || "0",
        amenities: {
          pool: document.body.innerText.toLowerCase().includes('piscina'),
          security: document.body.innerText.toLowerCase().includes('seguridad') || document.body.innerText.toLowerCase().includes('gated'),
          beachTransport: document.body.innerText.toLowerCase().includes('traslado') || document.body.innerText.toLowerCase().includes('shuttle')
        },
        timestamp: new Date().toISOString()
      };
    });

    console.log("[StayHost Bot] Datos extraídos con éxito:");
    console.table(data);
    
    return data;

  } catch (error) {
    console.error(`[StayHost Bot] Error analizando la URL: ${error.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

// Exportar para uso en la API de StayHost
module.exports = { scrapeAirbnb };
