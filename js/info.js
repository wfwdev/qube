// ============================================================
// Infó oldal – belépés nélkül is elérhető (a telepítési útmutató
// már a regisztráció előtt kellhet), ezért nem vár a munkamenetre.
// ============================================================
import { APP } from './config.js';
import { $, hideScreen, renderChrome, setPageTabs } from './ui.js';

// Alsó menü: Kezdőlap · Infó (jogosultság nélküli, minimális munkamenettel)
renderChrome({ can: () => false });
setPageTabs([{ id: 'info', icon: 'ℹ️', label: 'Infó' }], () => {});
hideScreen();

$('#appVersion').textContent = `Verzió: ${APP.version}${APP.build && APP.build !== 'dev' ? ` (${APP.build})` : ''}`;

// Telepítve van-e már, és milyen telefon – a megfelelő útmutató nyíljon ki
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);

const state = $('#installState');
if (standalone) {
    state.textContent = '✓ A Qube telepítve van ezen a telefonon.';
    state.classList.add('notice-ok');
} else {
    state.textContent = 'A Qube most böngészőben fut. Telepítsd a kezdőképernyőre – lásd lent.';
    if (isIos) $('#secIos').open = true;
    if (isAndroid) $('#secAndroid').open = true;
}
state.classList.remove('hidden');
