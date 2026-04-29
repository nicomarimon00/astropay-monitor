// app/api/price/route.js
// Serverless function que hace scraping de la cotización ARS→USDT
// de AstroPay. Corre en Vercel (Node.js edge), evita CORS.

export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  try {
    const res = await fetch(
      'https://www.astropay.com/currency-exchange/ars-to-ust-rate',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)',
          'Accept': 'text/html',
        },
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // El HTML contiene algo como: "$1 ARS = 1.400 UST" o "1 ARS = 0.000714 UST"
    // También busca: "ARS exchange rate today" seguido del valor
    const patterns = [
      /\$1\s*ARS\s*=\s*([\d.,]+)\s*UST/i,
      /1\s*ARS\s*=\s*([\d.,]+)\s*UST/i,
      /exchange-rate[^>]*>([\d.,]+)</i,
    ];

    let rate = null;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        // El valor es ARS por 1 USDT inverso: necesitamos USDT/ARS
        rate = parseFloat(match[1].replace(',', '.'));
        break;
      }
    }

    if (!rate) throw new Error('parse_fail');

    // rate es "cuántos USDT por 1 ARS", necesitamos "cuántos ARS por 1 USDT"
    const arsPerUsdt = 1 / rate;

    return Response.json({
      bid: arsPerUsdt,
      ask: arsPerUsdt * 1.005,
      source: 'AstroPay',
      ts: Date.now(),
    });

  } catch (err) {
    // Fallback: CryptoYa
    try {
      const r = await fetch('https://criptoya.com/api/astropay/usdt/ars/1');
      const d = await r.json();
      return Response.json({
        bid: d.bid ?? d.totalBid,
        ask: d.ask ?? d.totalAsk,
        source: 'CryptoYa',
        ts: Date.now(),
      });
    } catch {
      return Response.json(
        { error: 'fetch_failed', message: err.message },
        { status: 502 }
      );
    }
  }
}