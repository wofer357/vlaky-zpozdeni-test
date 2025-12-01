export default async function handler(req, res) {
    const GOLEMIO_API_KEY = process.env.GOLEMIO_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NDI4MCwiaWF0IjoxNzY0NjI4NDcwLCJleHAiOjExNzY0NjI4NDcwLCJpc3MiOiJnb2xlbWlvIiwianRpIjoiODhiMDQ4MzktOGI1Yy00ZjQxLTkzOWItZTA5ZjZlZDVkODZmIn0.1nlLv3mu-eC2bt_AokvJSP3i-ri2yupS7TfIA4Upaog'; 

    try {
        // --- 1. Konfigurace ---
        const commonParams = {
            minutesBefore: 10, // Malá historie pro jistotu
            minutesAfter: 180, // 3 hodiny dopředu
            limit: 40,
            includeDelay: true 
        };

        // --- 2. Fetchování dat (Výstaviště + Dejvice) ---
        // Výstaviště: Pro Osobní vlaky (S), které tam staví.
        const paramsVystavisteDep = new URLSearchParams({ ...commonParams, names: 'Praha-Výstaviště', mode: 'departures' });
        const paramsVystavisteArr = new URLSearchParams({ ...commonParams, names: 'Praha-Výstaviště', mode: 'arrivals' });
        
        // Dejvice: Pro Rychlíky (R) a Spěšné (Sp), které Výstavištěm jen projedou.
        const paramsDejviceDep = new URLSearchParams({ ...commonParams, names: 'Praha-Dejvice', mode: 'departures' });
        const paramsDejviceArr = new URLSearchParams({ ...commonParams, names: 'Praha-Dejvice', mode: 'arrivals' });

        const [resVysDep, resVysArr, resDejDep, resDejArr] = await Promise.all([
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsVystavisteDep}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsVystavisteArr}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejviceDep}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } }),
            fetch(`https://api.golemio.cz/v2/pid/departureboards?${paramsDejviceArr}`, { headers: { 'X-Access-Token': GOLEMIO_API_KEY } })
        ]);

        const dataVysDep = await resVysDep.json();
        const dataVysArr = await resVysArr.json();
        const dataDejDep = await resDejDep.json();
        const dataDejArr = await resDejArr.json();

        let bridgeSchedule = [];
        let processedTrains = new Set(); // Abychom neměli duplicity

        // --- 3. Zpracování VÝSTAVIŠTĚ (Přesné časy pro S-linky) ---
        
        // Směr Z Prahy (Odjezdy z Výstaviště na Kladno)
        dataVysDep.forEach(item => {
            const dest = item.trip.headsign;
            // Filtrujeme vlaky jedoucí ven z města
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

        // Směr DO Prahy (Příjezdy na Výstaviště z Kladna)
        dataVysArr.forEach(item => {
            const dest = item.trip.headsign;
            // Filtrujeme vlaky končící v centru
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

        // --- 4. Zpracování DEJVICE (Dopočet pro Rychlíky) ---
        // Použijeme jen vlaky, které jsme nenašli na Výstavišti (tzn. ty co tam nestaví)

        // Směr DO Prahy (Odjezdy z Dejvic -> Bubny -> Most)
        // Vlak odjede z Dejvic a cca za 3 minuty je pod mostem.
        dataDejDep.forEach(item => {
            const trainNum = item.trip.short_name;
            const dest = item.trip.headsign;

            // Chceme jen vlaky do centra, které jsme ještě nepridali (tzn. Rychlíky)
            if (!processedTrains.has(trainNum) && (dest.includes('Masaryk') || dest.includes('Bubny') || dest.includes('Hlavní') || dest.includes('Praha'))) {
                const scheduledTime = new Date(item.departure_timestamp.predicted);
                // Korekce: Dejvice -> Most trvá cca 3 minuty
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

        // Směr Z Prahy (Příjezdy do Dejvic <- Most <- Bubny)
        // Vlak přijede do Dejvic, takže pod mostem musel být dřív (cca před 3 minutami).
        dataDejArr.forEach(item => {
            const trainNum = item.trip.short_name;
            const dest = item.trip.headsign;

            // Chceme jen vlaky VEN z města (Kladno, Rakovník...), které nejsou v seznamu
            if (!processedTrains.has(trainNum) && !dest.includes('Masaryk') && !dest.includes('Bubny') && !dest.includes('Hlavní')) {
                const scheduledTime = new Date(item.arrival_timestamp.predicted);
                // Korekce: Most -> Dejvice trvá cca 3 minuty (takže pod mostem byl dřív)
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

        // --- 5. Seřazení a filtrace ---
        bridgeSchedule.sort((a, b) => new Date(a.time) - new Date(b.time));

        const now = new Date();
        // Necháme rezervu 1 minutu do minulosti, aby vlak nezmizel hned jak projede
        const futureSchedule = bridgeSchedule.filter(item => new Date(item.time) > new Date(now.getTime() - 60000));

        return res.status(200).json(futureSchedule);

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Chyba serveru' });
    }
}
