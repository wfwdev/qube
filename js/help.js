// ============================================================
// Modul súgók – minden modul saját leírása egy helyen.
// Új modulnál: új bejegyzés a HELP-be, és a modul oldalán:
//     import { registerHelp } from './help.js';  registerHelp('modul-id');
// ============================================================
import { openSheet, closeSheet, setHelp, feedback, $ } from './ui.js';

const HELP = {
    ic: {
        title: '⚡ IC generátor',
        html: `
            <h6>Generálás</h6>
            <ol>
                <li>Válaszd ki a területet (<b>ESS</b> / <b>WSS</b>).</li>
                <li>Válaszd ki az <b>IC</b>-t a listából.</li>
                <li>Add meg a <b>mennyiséget</b> (legfeljebb 5000).</li>
                <li>Koppints a <b>Generálás</b> gombra – megjelenik a két QR kód, ezeket kell lecsippantani.</li>
            </ol>
            <p>A <b>Bezárás</b> után a mezők kiürülnek, a terület megmarad.</p>
            <h6>Utolsó generálás</h6>
            <p>A Generálás gomb alatti kártyára koppintva ugyanaz a két QR újra megnyitható. Ez <b>nem</b> számít új generálásnak.</p>
            <h6>Internet nélkül</h6>
            <p>A generálás internet nélkül is működik a telefonon tárolt IC listából. A generálás naplója „⏳ feltöltésre vár” jelzéssel megvárja a netet, és utána magától felmegy.</p>
            <h6>Lista és Statisztika</h6>
            <p>Ha a szerepköröd engedi, alul megjelenik a <b>Lista</b> (IC-k felvétele, terület módosítása, törlés, importálás beillesztéssel) és a <b>Statisztika</b> (napi és havi összesítő, IC-nként). Ezekhez internet kell.</p>
            <h6>Adatok</h6>
            <p>Minden generálásnál a szerverre kerül: ki, mikor, melyik IC-ből, mennyit generált. Ebből készül a statisztika.</p>`
    },
    mes: {
        title: '💻 MES terminál',
        html: `
            <h6>Első beállítás</h6>
            <p>Add meg a MES <b>felhasználóneved</b> és <b>jelszavad</b>, majd <b>Mentés</b>. Ezek <b>csak ezen a telefonon</b> tárolódnak, a szerverre nem kerülnek fel.</p>
            <h6>Belépés</h6>
            <ol>
                <li>Koppints a <b>Belépő QR megjelenítése</b> gombra.</li>
                <li>Csippantsd le a QR-t a terminálnál – kitölti a mezőket és belép (F4).</li>
            </ol>
            <h6>Beállítások</h6>
            <ul>
                <li><b>Belépés módja – Egy QR kód:</b> egy csippantással belép.</li>
                <li><b>Két QR kód:</b> ha egy kóddal nem lép be (pl. <b>@</b>, <b>#</b> vagy más különleges karakter van a jelszavadban). Az első kód kitölti az adatokat, a második belép.</li>
                <li><b>Belépés után TAB:</b> belépés után a következő mezőre lép.</li>
                <li><b>A QR ennyi idő után eltűnik:</b> biztonsági okból a QR magától eltűnik (15 mp – 2 perc), vagy csak bezáráskor.</li>
            </ul>
            <h6>Jó tudni</h6>
            <ul>
                <li>Internet nélkül is működik.</li>
                <li>Amíg a QR látszik, a kijelző nem alszik el. Ha az appot háttérbe teszed, a QR eltűnik.</li>
                <li>Ha megváltozik a MES jelszavad, az <b>Adatok módosítása</b> gombbal frissítsd.</li>
                <li>Telefoncsere vagy leadás előtt töröld az adatokat.</li>
            </ul>`
    },
    pack: {
        title: '📦 Csomagoló kód',
        html: `
            <h6>Használat</h6>
            <ol>
                <li>Add meg a csomagoló kódodat (csak számjegyek), majd <b>Mentés</b>.</li>
                <li>A <b>QR megjelenítése</b> gombbal bármikor előhívhatod, és lecsippanthatod.</li>
            </ol>
            <p>A QR pontosan a számot tartalmazza.</p>
            <h6>Jó tudni</h6>
            <ul>
                <li>A kód <b>csak ezen a telefonon</b> tárolódik.</li>
                <li>Internet nélkül is működik.</li>
                <li>Az eltűnési idő itt külön állítható.</li>
                <li>A kód a <b>Kód módosítása</b> gombbal cserélhető vagy törölhető.</li>
            </ul>`
    },
    calendar: {
        title: '📅 Munkaidő naptár',
        html: `
            <h6>Naptár</h6>
            <ul>
                <li><b>Piros</b>: munkaszüneti nap (ünnep), <b>sárga „M”</b>: ledolgozós szombat, <b>szaggatott</b>: áthelyezett pihenőnap.</li>
                <li>A bal oldali oszlopban a heti műszakod látszik (<b>DE</b> / <b>DU</b> / <b>É</b>), ha beállítottad.</li>
                <li>A kék szám a nap sarkában: ennyi kolléga van aznap szabadságon.</li>
                <li>Lapozni a nyilakkal vagy oldalra húzással lehet; a hónap nevére koppintva visszaugrik a mai naphoz.</li>
            </ul>
            <h6>Szabadság bejelölése</h6>
            <p>Koppints egy munkanapra → <b>Szabadságon leszek ezen a napon</b>. Ugyanígy törölhető. Nincs jóváhagyás, csak tájékoztató jellegű – <b>mindenki látja</b>, ki mikor van szabadságon. Bejelöléshez internet kell.</p>
            <h6>Szabadságkeret</h6>
            <p>A <b>Szabadság</b> fülön add meg az éves keretedet – a számláló mutatja, mennyi maradt. Csak a munkanapra eső napok számítanak. A keretet csak te látod.</p>
            <h6>Műszakom</h6>
            <p>Állítsd be, hogy 3 műszakban vagy nappalosként dolgozol, és melyik műszakban vagy <b>ezen a héten</b>. A forgás sorrendjét is megadhatod. Ez csak ezen a telefonon tárolódik.</p>
            <h6>Jó tudni</h6>
            <p>Az ünnepnapokat az app magától számolja (a húsvéthoz kötötteket is). A naptár internet nélkül is megnézhető.</p>`
    },
    settings: {
        title: '⚙️ Vezérlőpult',
        html: `
            <h6>Áttekintés</h6>
            <p>Felül a legfontosabb számok: aktív felhasználók, összekapcsolásra váró fiókok és új visszajelzések. Ha valami teendőt jelez, piros keretet kap – koppintásra odaugrik.</p>
            <h6>Funkciók</h6>
            <ul>
                <li>A kapcsolóval azonnal be- vagy kikapcsolhatod a funkciót <b>minden felhasználónál</b>.</li>
                <li>A <b>›</b> jellel jelölt sorok részletes beállításokat nyitnak (pl. adventi üzenetek, munkanap-áthelyezések). Vissza a <b>‹</b> gombbal vagy a telefon vissza gombjával.</li>
            </ul>
            <h6>Biztonság</h6>
            <p>Tarts mindig legalább pár fel nem használt <b>admin vészkódot</b> – ha elfogynak, a sor pirosan jelez.</p>`
    },
    stats: {
        title: '📊 Statisztika',
        html: `
            <h6>Időszak</h6>
            <p>Felül: <b>Ma</b>, <b>7 nap</b> vagy <b>30 nap</b>. A <b>Saját használat nélkül</b> kihagyja a te adataidat (fejlesztés közbeni tesztelés ne torzítson). A 30 napos trend mindig mindenkit tartalmaz.</p>
            <h6>Fülek</h6>
            <ul>
                <li><b>Áttekintés:</b> aktív felhasználók, munkamenetek, használati idő, betöltési idő, offline szakaszok, napszakok, műveletek. A <b>JS hibák</b> és a felhasználóknak megjelent <b>hibaüzenetek</b> csoportosítva (hányszor, hány embernél, utoljára mikor) – koppintásra a részletek.</li>
                <li><b>Modulok:</b> melyik modult mennyi ideig, hányszor, hányan használták, mennyi idő alatt töltődik be. <b>Folyamatok:</b> hányan nyitották meg és csinálták is meg a fő műveletet.</li>
                <li><b>Emberek:</b> felhasználónként; koppintásra részletes idővonal (megnyitás, oldalak, műveletek, hibaüzenetek, offline, lassú betöltés). Alul: kik <b>nem használták</b> az időszakban.</li>
                <li><b>Eszközök:</b> app verziók, <b>ki maradt régi verzión</b>, kinél ragadt <b>feltöltésre váró adat</b>, telepített app vagy böngésző, rendszer, böngésző, betöltési idő.</li>
            </ul>
            <h6>Hogyan mér?</h6>
            <p>Az idő csak akkor számít, amíg az oldal a képernyőn van. Az adatok a telefonon gyűlnek, és legfeljebb 2 percenként, illetve az app háttérbe tételekor mennek fel – ezért a legfrissebb pár perc még hiányozhat. 30 perc szünet után új munkamenet kezdődik.</p>
            <h6>Hibabejelentés</h6>
            <p>Ha valaki <b>hibát</b> küld be, a telefon automatikusan csatolja az utolsó 30 eseményét, a készüléket, a hálózati állapotot és a feltöltésre váró adatokat – a Visszajelzéseknél a 🩺 Diagnosztika alatt látod.</p>
            <h6>Új hiba jelzés</h6>
            <p>A Vezérlőpulton piros jelzés mutatja, ha a statisztika legutóbbi megnyitása óta új hiba vagy hibaüzenet jött.</p>
            <h6>Kikapcsolás, törlés</h6>
            <p>A gyűjtés a <b>Vezérlőpulton</b> kikapcsolható. A 90 napnál régebbi adatok az Áttekintés alján törölhetők.</p>`
    },
    admin: {
        title: '👥 Felhasználók',
        html: `
            <h6>Felhasználók</h6>
            <ul>
                <li>Keresés névre vagy törzsszámra; szűrés: <b>Mind</b>, <b>Új / kérés</b>, <b>Várakozó</b>, <b>Letiltott</b>.</li>
                <li><b>Új / kérés:</b> az új regisztrálók és akik másik szerepkört kértek (regisztrációkor vagy a ☰ menüben). Koppints rájuk: <b>Jóváhagyom</b> egy gombnyomással megadja a kért szerepkört, vagy maradhat a mostani. A kezdőlapon és az alsó menüben jelzés mutatja, ha van ilyen.</li>
                <li>Egy felhasználóra koppintva módosítható a <b>szerepköre</b>, illetve <b>letiltható</b>.</li>
                <li>A <b>Várakozó</b> fiókok új eszközről jelentkeztek be egy már regisztrált törzsszámmal – ezeket az adminisztrátor kapcsolja össze a régi fiókkal.</li>
            </ul>
            <h6>Szerepkörök (admin)</h6>
            <p>Szerepkörök szerkesztése, új szerepkör felvétele, jogosultságok be- és kikapcsolása.</p>`
    }
};

const openHelp = (id) => {
    const h = HELP[id];
    if (!h) return;
    feedback();
    const sheet = openSheet(`
        <h5 class="fw-bold mb-3">${h.title} – Súgó</h5>
        <div class="help-body">${h.html}</div>
        <a class="btn btn-light w-100 mt-3" href="feedback.html?modul=${encodeURIComponent(id)}">💬 Hiba vagy ötlet ehhez a modulhoz</a>
        <button class="btn btn-primary w-100 mt-2" id="helpClose">Rendben</button>`);
    $('#helpClose', sheet).addEventListener('click', closeSheet);
};

export const registerHelp = (id) => { if (HELP[id]) setHelp(() => openHelp(id)); };
