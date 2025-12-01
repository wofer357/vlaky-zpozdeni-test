export default async function handler(req, res) {
    const { train } = req.query;
  
    if (!train) {
      return res.status(400).json({ error: 'Chybí číslo vlaku' });
    }
  
    // Váš API klíč
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI4MCwiaWF0IjoxNzY0NjI4NDcwLCJleHAiOjExNzY0NjI4NDcwLCJpc3MiOiJnb2xlbWlvIiwianRpIjoiODhiMDQ4MzktOGI1Yy00ZjQxLTkzOWItZTA5ZjZlZDVkODZmIn0.1nlLv3mu-eC2bt_AokvJSP3i-ri2yupS7TfIA4Upaog'; 
  
    try {
      // 1. Změna strategie: Nestahujeme jen konkrétní linky (S5, R24...), 
      // ale všechny vlaky ("vehicleType=train"). 
      // Tím máme jistotu, že nám neuteče žádný Spěšný vlak (Sp) ani Rychlík, 
      // i kdyby měl v datech jiné označení linky.
      const params = new URLSearchParams({
        limit: 5000, // Zvýšený limit pro jistotu
        vehicleType: 'train', 
        includePositions: true // Potřebujeme aktuální polohy/zpoždění
      });
      
      const response = await fetch(`https://api.golemio.cz/v2/vehiclepositions?${params.toString()}`, {
        headers: {
          'X-Access-Token': GOLEMIO_API_KEY,
          'Content-Type': 'application/json',
        },
      });
  
      if (!response.ok) {
        throw new Error(`Golemio API error: ${response.status}`);
      }
  
      const data = await response.json();
      
      // 2. Hledáme náš vlak v celém balíku dat
      const trainData = data.features.find(feature => {
        const tripName = feature.properties.trip.short_name;
        // Porovnáváme číslo vlaku (např. "9848" vs "9848")
        return tripName == train; 
      });
  
      if (trainData) {
        // delay je v sekundách, převedeme na minuty
        const delaySeconds = trainData.properties.delay_actual || 0;
        const delayMinutes = Math.floor(delaySeconds / 60);
        
        return res.status(200).json({ 
          train: train,
          delayMinutes: delayMinutes,
          found: true
        });
      } else {
        // Vlak se nenašel (možná ještě nevyjel, nebo je mimo sledovanou oblast)
        return res.status(200).json({ 
          train: train,
          delayMinutes: 0,
          found: false 
        });
      }
  
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Chyba při komunikaci s Golemio API' });
    }
  }
