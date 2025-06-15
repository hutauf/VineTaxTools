function calculateEuerValues(item, settings, avgTeilwertEtvRatio) {
    let use_teilwert = item.myteilwert || item.teilwert || (item.etv * avgTeilwertEtvRatio);
    if (item.storniert) return { einnahmen: 0, ausgaben: 0, entnahmen: 0, einnahmen_aus_anlagevermoegen: 0 };

    const itemDate = new Date(item.date);
    const cutoffDate = new Date(2024, 9, 1);

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
    const cleanString = etvString.replace(/[€ ]/g, '');
    const cleanedValue = cleanString.replace(/[.,](?=\d{3})/g, '');
    const etv = parseFloat(cleanedValue.replace(',', '.'));
    return etv;
}

module.exports = { calculateEuerValues, etvstrtofloat };
