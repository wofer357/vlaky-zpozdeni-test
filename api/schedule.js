export default async function handler(req, res) {
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY;

    if (!GOLEMIO_API_KEY) {
        return res.status(500).json({ error: 'Missing GOLEMIO_API_KEY' });
    }

    // PID stop_ids from Golemio (using ids param instead of old cisIds)
    const STOP_VYSTAVISTE = 'U532Z301';
    const STOP_DEJVICE = 'U163Z301';

    try {
        const commonParams = {
            // 24h window ahead; keep 30 min back for context
            minutesBefore: 30, 
            minutesAfter: 1440, 
            limit: 400
        };

        const paramsVysDep = new URLSearchParams({ ...commonParams, ids: STOP_VYSTAVISTE, mode: 'departures' });
        const paramsVysArr = new URLSearchParams({ ...commonParams, ids: STOP_VYSTAVISTE, mode: 'arrivals' });
        const paramsDejDep = new URLSearchParams({ ...commonParams, ids: STOP_DEJVICE, mode: 'departures' });
        const paramsDejArr = new URLSearchParams({ ...commonParams, ids: STOP_DEJVICE, mode: 'arrivals' });

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
            const listCount = (data) => {
                if (data?.error) return null;
                if (Array.isArray(data)) return data.length;
                if (Array.isArray(data?.departures)) return data.departures.length;
                return 0;
            };
            const formatDebug = (data) => data.error ? `CHYBA: ${data.status} - ${data.text}` : `${listCount(data)} spojů`;

            return res.status(200).json({
                info: "Diagnostika API v4 (Oprava parametrů)",
                config: {
                    vystaviste_id: STOP_VYSTAVISTE,
                    dejvice_id: STOP_DEJVICE
                },
                results: {
                    vystaviste_odjezdy: formatDebug(dataVysDep),
                    vystaviste_prijezdy: formatDebug(dataVysArr),
                    dejvice_odjezdy: formatDebug(dataDejDep),
                    dejvice_prijezdy: formatDebug(dataDejArr)
                },
                sample_data: !dataVysDep.error && Array.isArray(dataVysDep?.departures) && dataVysDep.departures.length > 0
                    ? dataVysDep.departures[0]
                    : "Žádná data nebo chyba"
            });
        }
        // -----------------

        const extractDepartures = (data) => {
            if (Array.isArray(data)) return data; // legacy shape
            if (data && Array.isArray(data.departures)) return data.departures;
            return [];
        };

        const listVysDep = extractDepartures(dataVysDep);
        const listVysArr = extractDepartures(dataVysArr);
        const listDejDep = extractDepartures(dataDejDep);
        const listDejArr = extractDepartures(dataDejArr);

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
                    direction: 'Dejvice',
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
                    direction: 'Výstav.',
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
            if (!processedTrains.has(trainNum) && (dest.includes('Masaryk') || dest.includes('Bubny') || dest.includes('Hlavní') || dest.includes('Praha'))) {
                const scheduledTime = new Date(item.departure_timestamp.predicted);
                const bridgeTime = new Date(scheduledTime.getTime() + (5 * 60000)); // +5 min

                bridgeSchedule.push({
                    type: 'inbound',
                    direction: 'Výstav.',
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
            if (!processedTrains.has(trainNum) && !dest.includes('Masaryk') && !dest.includes('Hlavní')) {
                const scheduledTime = new Date(item.arrival_timestamp.predicted);
                const offsetMinutes = trainNum.startsWith('Sp') ? 3 : 5; // Sp vlaky posuneme o 2 min méně (oproti 5 -> 3)
                const bridgeTime = new Date(scheduledTime.getTime() - (offsetMinutes * 60000));

                bridgeSchedule.push({
                    type: 'outbound',
                    direction: 'Dejvice',
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
