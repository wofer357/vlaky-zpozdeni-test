export default async function handler(req, res) {
    const { train } = req.query;
  
    if (!train) {
      return res.status(400).json({ error: 'Chybí číslo vlaku' });
    }
  
    // Váš API klíč
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI4MCwiaWF0IjoxNzY0NjI4NDcwLCJleHAiOjExNzY0NjI4NDcwLCJpc3MiOiJnb2xlbWlvIiwianRpIjoiODhiMDQ4MzktOGI1Yy00ZjQxLTkzOWItZTA5ZjZlZDVkODZmIn0.1nlLv3mu-eC2bt_AokvJSP3i-ri2yupS7TfIA4Upaog'; 
  
    try {
      // Snížil jsem limit a zjednodušil dotaz pro debugování
      const params = new URLSearchParams({
        limit: 1000, 
        vehicleType: 'train', 
        includePositions: true 
      });
      
      const apiUrl = `https://api.golemio.cz/v2/vehiclepositions?${params.toString()}`;
      
      console.log(`Fetching: ${apiUrl}`); // Uvidíte v logách Vercelu

      const response = await fetch(apiUrl, {
        headers: {
          'X-Access-Token': GOLEMIO_API_KEY,
          'Content-Type': 'application/json',
        },
      });
  
      // --- DEBUGGING BLOK ---
      // Pokud Golemio vrátí chybu, pošleme ji přímo do prohlížeče, abychom ji viděli
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Golemio Error:', response.status, errorText);
        
        return res.status(response.status).json({ 
            error: 'Chyba Golemio API', 
            status: response.status,
            statusText: response.statusText,
            details: errorText
        });
      }
      // ----------------------
  
      const data = await response.json();
      
      const trainData = data.features.find(feature => {
        const tripName = feature.properties.trip.short_name;
        return tripName == train; 
      });
  
      if (trainData) {
        const delaySeconds = trainData.properties.delay_actual || 0;
        const delayMinutes = Math.floor(delaySeconds / 60);
        
        return res.status(200).json({ 
          train: train,
          delayMinutes: delayMinutes,
          found: true
        });
      } else {
        return res.status(200).json({ 
          train: train,
          delayMinutes: 0,
          found: false 
        });
      }
  
    } catch (error) {
      console.error(error);
      return res.status(500).json({ 
          error: 'Kritická chyba serveru', 
          message: error.message 
      });
    }
  }
