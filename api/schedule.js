export default async function handler(req, res) {
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI4MCwiaWF0IjoxNzY0NjI4NDcwLCJleHAiOjExNzY0NjI4NDcwLCJpc3MiOiJnb2xlbWlvIiwianRpIjoiODhiMDQ4MzktOGI1Yy00ZjQxLTkzOWItZTA5ZjZlZDVkODZmIn0.1nlLv3mu-eC2bt_AokvJSP3i-ri2yupS7TfIA4Upaog'; 

    try {
        const commonParams = {
            minutesBefore: 10,
            minutesAfter: 180, 
            limit: 40,
            includeDelay: true 
        };

        const paramsVysDep = new URLSearchParams({ ...commonParams, names: 'Praha-Výstaviště', mode: 'departures' });
        const paramsVysArr = new URLSearchParams({ ...commonParams, names: 'Praha-Výstaviště', mode: 'arrivals' });
        const paramsDejDep = new URLSearchParams({ ...commonParams, names: 'Praha-Dejvice', mode: 'departures' });
        const paramsDejArr = new URLSearchParams({ ...commonParams, names: 'Praha-Dejvice', mode: 'arrivals' });

        // Použijeme allSettled místo all, aby jedna chyba neshodila vše
        const results = await Promise.allSettled([
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsVysDep}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsVysArr}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejDep}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejArr}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } })
        ]);

        // Helper pro získání JSONu z výsledku
        const getData = async (result) => {
            if (result.status === 'fulfilled' && result.value.ok) {
                return await result.value.json();
            }
            return []; // Pokud selže, vrátíme prázdné pole
        };

        const dataVysDep = await getData(results[0]);
        const dataVysArr = await getData(results[1]);
        const dataDejDep = await getData(results[2]);
        const dataDejArr = await getData(results[3]);

        let bridgeSchedule = [];
        let processedTrains = new Set(); 

        // --- Zpracování VÝSTAVIŠTĚ ---
        dataVysDep.forEach(item => {
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

        dataVysArr.forEach(item => {
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

        // --- Zpracování DEJVICE ---
        dataDejDep.forEach(item => {
            const trainNum = item.trip.short_name;
            const dest = item.trip.headsign;
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

        dataDejArr.forEach(item => {
            const trainNum = item.trip.short_name;
            const dest = item.trip.headsign;
            if (!processedTrains.has(trainNum) && !dest.includes('Masaryk') && !dest.includes('Bubny') && !dest.includes('Hlavní')) {
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
