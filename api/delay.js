export default async function handler(req, res) {
    const { train } = req.query;
  
    if (!train) {
      return res.status(400).json({ error: 'Chybí číslo vlaku' });
    }
  
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI4MCwiaWF0IjoxNzY0NjI4NDcwLCJleHAiOjExNzY0NjI4NDcwLCJpc3MiOiJnb2xlbWlvIiwianRpIjoiODhiMDQ4MzktOGI1Yy00ZjQxLTkzOWItZTA5ZjZlZDVkODZmIn0.1nlLv3mu-eC2bt_AokvJSP3i-ri2yupS7TfIA4Upaog'; 
  
    try {
      // Strategie: Místo poloh všech vozidel se ptáme na zastávku "Praha-Výstaviště".
      // Musíme zkontrolovat ODJEZDY (pro vlaky na Dejvice) i PŘÍJEZDY (pro vlaky od Dejvic).
      
      const commonParams = {
        names: 'Praha-Výstaviště',
        minutesBefore: 120, // Hledáme i vlaky, co měly jet před chvílí (kvůli zpoždění)
        minutesAfter: 120,  // A vlaky co pojedou za chvíli
        limit: 50
      };

      const paramsDep = new URLSearchParams({ ...commonParams, mode: 'departures' });
      const paramsArr = new URLSearchParams({ ...commonParams, mode: 'arrivals' });

      // Spustíme oba dotazy paralelně
      const [respDep, respArr] = await Promise.all([
        fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDep.toString()}`, {
            headers: { 'X-Access-Token': GOLEMIO_API_KEY }
        }),
        fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsArr.toString()}`, {
            headers: { 'X-Access-Token': GOLEMIO_API_KEY }
        })
      ]);

      let allTrips = [];

      if (respDep.ok) {
        const dataDep = await respDep.json();
        allTrips = allTrips.concat(dataDep);
      }
      
      if (respArr.ok) {
        const dataArr = await respArr.json();
        allTrips = allTrips.concat(dataArr);
      }

      // Hledáme náš vlak v tabulích (podle čísla vlaku v trip.short_name)
      // short_name bývá např. "Os 9812" nebo jen "9812". Porovnáváme, zda obsahuje naše číslo.
      const trainData = allTrips.find(item => {
        const shortName = item.trip.short_name || "";
        return shortName.includes(train); 
      });

      if (trainData) {
        // Golemio vrací "delay" v minutách přímo v objektu
        // (někdy v delay_minutes, někdy jako objekt delay.minutes)
        const delay = trainData.delay?.minutes ?? 0;
        
        return res.status(200).json({ 
          train: train,
          delayMinutes: delay,
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
          error: 'Chyba serveru', 
          message: error.message 
      });
    }
  }
