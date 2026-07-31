function calculateEuerValues(item, settings, avgTeilwertEtvRatio) {
    let use_teilwert = item.myteilwert ?? item.teilwert ?? (item.etv * avgTeilwertEtvRatio);
    if (item.storniert) return { einnahmen: 0, ausgaben: 0, entnahmen: 0, einnahmen_aus_anlagevermoegen: 0 };

    const match = typeof item.date === 'string'
        ? item.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
        : null;
    const parsedDate = match
        ? new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])))
        : null;
    const itemDate = parsedDate
        && parsedDate.getUTCFullYear() === Number(match[3])
        && parsedDate.getUTCMonth() === Number(match[2]) - 1
        && parsedDate.getUTCDate() === Number(match[1])
        ? parsedDate.getTime()
        : NaN;
    const cutoffDate = Date.UTC(2024, 9, 1);

    let einnahmen = 0;
    let ausgaben = 0;
    let entnahmen = 0;
    let einnahmen_aus_anlagevermoegen = 0;

    if (settings.einnahmezumteilwert && itemDate < cutoffDate) {
        einnahmen += use_teilwert;
        ausgaben += use_teilwert;
    } else {
        einnahmen += item.etv;
        ausgaben += item.etv;
    }

    if (item.entsorgt || item.lager || item.betriebsausgabe) return { einnahmen, ausgaben, entnahmen, einnahmen_aus_anlagevermoegen };

    if (item.verkauft) {
        einnahmen_aus_anlagevermoegen += use_teilwert;
    } else {
        entnahmen += use_teilwert;
    }

    return { einnahmen, ausgaben, entnahmen, einnahmen_aus_anlagevermoegen };
}

function etvstrtofloat(etvString) {
    if (typeof etvString === 'number') {
        return etvString;
    }
    if (typeof etvString !== 'string') {
        return NaN;
    }
    const cleanString = etvString.replace(/[€\s]/g, '');
    if (cleanString === '') {
        return NaN;
    }
    const cleanedValue = cleanString.replace(/[.,](?=\d{3})/g, '');
    const etv = Number(cleanedValue.replace(',', '.'));
    return etv;
}

module.exports = { calculateEuerValues, etvstrtofloat };
