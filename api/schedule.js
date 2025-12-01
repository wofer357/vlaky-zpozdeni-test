export default async function handler(req, res) {
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI4MCwiaWF0IjoxNzY0NjI4NDcwLCJleHAiOjExNzY0NjI4NDcwLCJpc3MiOiJnb2xlbWlvIiwianRpIjoiODhiMDQ4MzktOGI1Yy00ZjQxLTkzOWItZTA5ZjZlZDVkODZmIn0.1nlLv3mu-eC2bt_AokvJSP3i-ri2yupS7TfIA4Upaog'; 

    try {
        const commonParams = {
            minutesBefore: 60, // Zvýšeno pro debug, abychom něco našli i v noci
            minutesAfter: 240, 
            limit: 60,
            includeDelay: true 
        };

        const paramsVysDep = new URLSearchParams({ ...commonParams, names: 'Praha-Výstaviště', mode: 'departures' });
        const paramsVysArr = new URLSearchParams({ ...commonParams, names: 'Praha-Výstaviště', mode: 'arrivals' });
        const paramsDejDep = new URLSearchParams({ ...commonParams, names: 'Praha-Dejvice', mode: 'departures' });
        const paramsDejArr = new URLSearchParams({ ...commonParams, names: 'Praha-Dejvice', mode: 'arrivals' });

        const results = await Promise.allSettled([
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsVysDep}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsVysArr}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejDep}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejArr}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } })
        ]);

        const getData = async (result) => {
            if (result.status === 'fulfilled' && result.value.ok) {
                return await result.value.json();
            }
            return []; 
        };

        const dataVysDep = await getData(results[0]);
        const dataVysArr = await getData(results[1]);
        const dataDejDep = await getData(results[2]);
        const dataDejArr = await getData(results[3]);

        // --- DEBUG MÓD: Pokud je v URL ?debug=true, vrátíme surová data ---
        if (req.query.debug) {
            return res.status(200).json({
                info: "Diagnostika API",
                time_now: new Date().toISOString(),
                stations_check: {
                    vystaviste_odjezdy_count: dataVysDep.length,
                    vystaviste_prijezdy_count: dataVysArr.length,
                    dejvice_odjezdy_count: dataDejDep.length,
                    dejvice_prijezdy_count: dataDejArr.length
                },
                api_status: {
                    vystaviste_dep: results[0].status,
                    vystaviste_arr: results[1].status,
                    dejvice_dep: results[2].status,
                    dejvice_arr: results[3].status
                },
                sample_train_vystaviste: dataVysDep[0] ? dataVysDep[0].trip.headsign : "Žádná data",
                sample_train_dejvice: dataDejDep[0] ? dataDejDep[0].trip.headsign : "Žádná data"
            });
        }
        // ---------------------------------------------------------------

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
                const bridgeTime = new Date(scheduledTime.getTime() + (3 * 60000)); 

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
                const bridgeTime = new Date(scheduledTime.getTime() - (3 * 60000)); 

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
