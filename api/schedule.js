export default async function handler(req, res) {
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI4MCwiaWF0IjoxNzY0NjI4NDcwLCJleHAiOjExNzY0NjI4NDcwLCJpc3MiOiJnb2xlbWlvIiwianRpIjoiODhiMDQ4MzktOGI1Yy00ZjQxLTkzOWItZTA5ZjZlZDVkODZmIn0.1nlLv3mu-eC2bt_AokvJSP3i-ri2yupS7TfIA4Upaog'; 

    try {
        const commonParams = {
            minutesBefore: 60, 
            minutesAfter: 720, 
            limit: 100,
            includeDelay: true 
        };

        // POUŽIJEME CIS ID MÍSTO NÁZVŮ (JISTOTA)
        // 543368 = Praha-Výstaviště
        // 545439 = Praha-Dejvice
        const paramsVysDep = new URLSearchParams({ ...commonParams, cisIds: '543368', mode: 'departures' });
        const paramsVysArr = new URLSearchParams({ ...commonParams, cisIds: '543368', mode: 'arrivals' });
        const paramsDejDep = new URLSearchParams({ ...commonParams, cisIds: '545439', mode: 'departures' });
        const paramsDejArr = new URLSearchParams({ ...commonParams, cisIds: '545439', mode: 'arrivals' });

        // Pomocná funkce, která vrátí buď data, nebo objekt s chybou
        const fetchUrl = async (url) => {
            try {
                const response = await fetch(url, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } });
                if (!response.ok) {
                    const text = await response.text();
                    return { error: true, status: response.status, text: text };
                }
                return await response.json();
            } catch (e) {
                return { error: true, message: e.message };
            }
        };

        // Paralelní dotazy
        const [dataVysDep, dataVysArr, dataDejDep, dataDejArr] = await Promise.all([
            fetchUrl(`https://api.golemio.cz/v2/pid/departureboards?${paramsVysDep}`),
            fetchUrl(`https://api.golemio.cz/v2/pid/departureboards?${paramsVysArr}`),
            fetchUrl(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejDep}`),
            fetchUrl(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejArr}`)
        ]);

        // --- DEBUG MÓD ---
        if (req.query.debug) {
            // Helper function to format output or show error
            const formatDebug = (data) => data.error ? `CHYBA: ${data.status} - ${data.text}` : `${data.length} spojů`;

            return res.status(200).json({
                info: "Diagnostika API v3 (CIS IDs)",
                config: {
                    vystaviste_id: '543368',
                    dejvice_id: '545439'
                },
                results: {
                    vystaviste_odjezdy: formatDebug(dataVysDep),
                    vystaviste_prijezdy: formatDebug(dataVysArr),
                    dejvice_odjezdy: formatDebug(dataDejDep),
                    dejvice_prijezdy: formatDebug(dataDejArr)
                },
                sample_data: !dataVysDep.error && dataVysDep.length > 0 ? dataVysDep[0] : "Žádná data nebo chyba"
            });
        }
        // -----------------

        // Pokud některý dotaz selhal, nahradíme ho prázdným polem, aby aplikace nespadla
        const safeList = (data) => Array.isArray(data) ? data : [];

        const listVysDep = safeList(dataVysDep);
        const listVysArr = safeList(dataVysArr);
        const listDejDep = safeList(dataDejDep);
        const listDejArr = safeList(dataDejArr);

        let bridgeSchedule = [];
        let processedTrains = new Set(); 

        // 1. VÝSTAVIŠTĚ (ID 543368)
        listVysDep.forEach(item => {
            const dest = item.trip.headsign;
            if (!dest.includes('Masaryk') && !dest.includes('Bubny') && !dest.includes('Hlavní')) {
                const bridgeTime = new Date(item.departure_timestamp.predicted);
                const trainNum = item.trip.short_name;
                
                bridgeSchedule.push({
                    type: 'outbound',
                    direction: dest,
                    train: trainNum,
                    time: bridgeTime.toISOString(),
                    delay: item.delay.minutes
                });
                processedTrains.add(trainNum);
            }
        });

        listVysArr.forEach(item => {
            const dest = item.trip.headsign;
            if (dest.includes('Masaryk') || dest.includes('Bubny') || dest.includes('Hlavní') || dest.includes('Praha')) {
                const bridgeTime = new Date(item.arrival_timestamp.predicted);
                const trainNum = item.trip.short_name;

                bridgeSchedule.push({
                    type: 'inbound',
                    direction: dest,
                    train: trainNum,
                    time: bridgeTime.toISOString(),
                    delay: item.delay.minutes
                });
                processedTrains.add(trainNum);
            }
        });

        // 2. DEJVICE (ID 545439)
        listDejDep.forEach(item => {
            const trainNum = item.trip.short_name;
            const dest = item.trip.headsign;
            // Vlaky DO centra, co jsme ještě nenašli (rychlíky)
            if (!processedTrains.has(trainNum) && (dest.includes('Masaryk') || dest.includes('Bubny') || dest.includes('Hlavní') || dest.includes('Praha'))) {
                const scheduledTime = new Date(item.departure_timestamp.predicted);
                const bridgeTime = new Date(scheduledTime.getTime() + (3 * 60000)); // +3 min

                bridgeSchedule.push({
                    type: 'inbound',
                    direction: dest,
                    train: trainNum,
                    time: bridgeTime.toISOString(),
                    delay: item.delay.minutes
                });
                processedTrains.add(trainNum);
            }
        });

        listDejArr.forEach(item => {
            const trainNum = item.trip.short_name;
            const dest = item.trip.headsign;
            // Vlaky Z centra, co jsme ještě nenašli
            if (!processedTrains.has(trainNum) && !dest.includes('Masaryk') && !dest.includes('Hlavní')) {
                const scheduledTime = new Date(item.arrival_timestamp.predicted);
                const bridgeTime = new Date(scheduledTime.getTime() - (3 * 60000)); // -3 min

                bridgeSchedule.push({
                    type: 'outbound',
                    direction: dest,
                    train: trainNum,
                    time: bridgeTime.toISOString(),
                    delay: item.delay.minutes
                });
                processedTrains.add(trainNum);
            }
        });

        bridgeSchedule.sort((a, b) => new Date(a.time) - new Date(b.time));

        const now = new Date();
        const futureSchedule = bridgeSchedule.filter(item => new Date(item.time) > new Date(now.getTime() - 60000));

        return res.status(200).json(futureSchedule);

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
