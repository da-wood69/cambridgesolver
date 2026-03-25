function parseRSCEntries(html) {
    const entries = [];
    let match;
    const regex = /{"name":"([^"]+?)","relPath":"([^"]+?)","isDir":true}/g;
    while ((match = regex.exec(html)) !== null) {
        entries.push({ name: match[1], relPath: match[2] });
    }
    return entries;
}

async function scrapeLevel(levelSlug, levelName) {
    const url = `https://pastpapers.co/cie/${levelSlug}/`;
    console.log(`Fetching ${url}...`);
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const entries = parseRSCEntries(html);
    
    return entries.map(e => {
        let splitIdx = e.name.lastIndexOf('-');
        let name = e.name;
        let code = '';
        if (splitIdx !== -1) {
            name = e.name.substring(0, splitIdx).replace(/-/g, ' ').trim();
            code = e.name.substring(splitIdx + 1).trim();
            if (!/^\d{4}$/.test(code)) {
                name = e.name.replace(/-/g, ' ');
                code = ''; // Not a standard code
            }
        } else {
            name = e.name.replace(/-/g, ' ');
        }
        
        if (code) {
           name = name.replace(/\([^)]+\)/g, '').trim(); 
        }

        return {
            name,
            code,
            slug: e.name,
            level: levelName
        };
    }).filter(e => e.name !== 'Syllabus' && e.name !== 'Specimen' && e.name !== 'common');
}

async function main() {
    try {
        const oLevel = await scrapeLevel('o-level', 'O-Level');
        const igcse = await scrapeLevel('igcse', 'IGCSE');
        
        require('fs').writeFileSync('scraped_subjects.json', JSON.stringify([...oLevel, ...igcse], null, 2));
        console.log(`Saved ${oLevel.length} O-Level and ${igcse.length} IGCSE subjects.`);
    } catch (err) {
        console.error(err);
    }
}

main();
