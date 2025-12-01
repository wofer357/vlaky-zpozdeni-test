export default async function handler(req, res) {
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI4MCwiaWF0IjoxNzY0NjI4NDcwLCJleHAiOjExNzY0NjI4NDcwLCJpc3MiOiJnb2xlbWlvIiwianRpIjoiODhiMDQ4MzktOGI1Yy00ZjQxLTkzOWItZTA5ZjZlZDVkODZmIn0.1nlLv3mu-eC2bt_AokvJSP3i-ri2yupS7TfIA4Upaog'; 

    try {
        const commonParams = {
            minutesBefore: 60, 
            minutesAfter: 720, // Hledáme 12 hodin dopředu, abychom našli ranní spoje
            limit: 100,
            includeDelay: true 
        };

        // Zkusíme více variant názvů zastávek, abychom měli jistotu
        const stationNames = 'Praha-Výstaviště,Praha-Holešovice zastávka,Praha-Bubny';
        const dejviceName = 'Praha-Dejvice';

        const paramsMainDep = new URLSearchParams({ ...commonParams, names: stationNames, mode: 'departures' });
        const paramsMainArr = new URLSearchParams({ ...commonParams, names: stationNames, mode: 'arrivals' });
        const paramsDejDep = new URLSearchParams({ ...commonParams, names: dejviceName, mode: 'departures' });
        const paramsDejArr = new URLSearchParams({ ...commonParams, names: dejviceName, mode: 'arrivals' });

        const results = await Promise.allSettled([
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsMainDep}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsMainArr}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejDep}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejArr}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } })
        ]);

        const getData = async (result) => {
            if (result.status === 'fulfilled' && result.value.ok) {
                return await result.value.json();
            }
            return []; 
        };

        const dataMainDep = await getData(results[0]);
        const dataMainArr = await getData(results[1]);
        const dataDejDep = await getData(results[2]);
        const dataDejArr = await getData(results[3]);

        // --- DEBUG MÓD ---
        if (req.query.debug) {
            return res.status(200).json({
                info: "Diagnostika API v2",
                server_time_utc: new Date().toISOString(),
                local_time_prague_approx: new Date(new Date().getTime() + 3600000).toISOString(),
                stations_searched: stationNames,
                check: {
                    vystaviste_bubny_odjezdy: dataMainDep.length,
                    vystaviste_bubny_prijezdy: dataMainArr.length,
                    dejvice_odjezdy: dataDejDep.length,
                    dejvice_prijezdy: dataDejArr.length
                },
                urls: {
                    main_dep: `.../departureboards?${paramsMainDep}`,
                    dejvice_dep: `.../departureboards?${paramsDejDep}`
                },
                sample_data: dataMainDep.slice(0, 2).map(t => ({ train: t.trip.short_name, headsign: t.trip.headsign, time: t.departure_timestamp.predicted }))
            });
        }
        // -----------------

        let bridgeSchedule = [];
        let processedTrains = new Set(); 

        // 1. VÝSTAVIŠTĚ / BUBNY (Preferovaná data)
        // Směr Z Prahy (Odjezdy)
        dataMainDep.forEach(item => {
            const dest = item.trip.headsign;
            // Filtrujeme vlaky jedoucí ven (ne na Masaryčku/Hlavák)
            if (!dest.includes('Masaryk') && !dest.includes('Hlavní') && item.stop.name.includes('Výstaviště')) {
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

        // Směr DO Prahy (Příjezdy)
        dataMainArr.forEach(item => {
            const dest = item.trip.headsign;
            if ((dest.includes('Masaryk') || dest.includes('Hlavní') || dest.includes('Praha')) && item.stop.name.includes('Výstaviště')) {
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

        // 2. DEJVICE (Záloha pro Rychlíky co nestaví na Výstavišti)
        // Směr DO Prahy (Odjezd z Dejvic -> Most)
        dataDejDep.forEach(item => {
            const trainNum = item.trip.short_name;
            const dest = item.trip.headsign;

            if (!processedTrains.has(trainNum) && (dest.includes('Masaryk') || dest.includes('Hlavní') || dest.includes('Praha'))) {
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

        // Směr Z Prahy (Příjezd do Dejvic <- Most)
        dataDejArr.forEach(item => {
            const trainNum = item.trip.short_name;
            const dest = item.trip.headsign;

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
