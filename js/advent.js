// ============================================================
// Adventi naptár + hóesés
// - December 1–24.: minden nap egy újabb ablak nyitható ki
// - December 25–31.: minden ablak nyitható, "Boldog karácsonyt"
// - A kinyitott ablakok telefononként, Qube-fiókonként tárolódnak
// ============================================================
import { esc, $, feedback, toast, openSheet } from './ui.js';

// Névelő a sorszám elé (1–31 között: "az 1.", "az 5.", minden más "a")
export const az = (n) => ([1, 5].includes(Number(n)) ? 'az' : 'a');

// Hányadik ablakig nyitható ma? (0 = ma nem aktív a naptár)
export const adventDay = (d = new Date()) => {
    if (d.getMonth() !== 11) return 0;          // csak decemberben
    return Math.min(d.getDate(), 24);           // 25–31. között mind nyitható
};

const loadOpened = (key) => { if (!key) return []; try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
const saveOpened = (key, list) => { if (!key) return; try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* tele */ } };

export const openedKey = (uid, year = new Date().getFullYear()) => `qube_advent_${uid}_${year}`;

// day: a mai nap (1–24) · messages: 24 üzenet · key: tárolási kulcs (null = előnézet, nem ment)
export const openAdvent = ({ day, messages, key, preview = false }) => {
    let opened = loadOpened(key);
    const christmas = day >= 24 && !preview && new Date().getDate() >= 25;

    const sheet = openSheet(`
        <div class="text-center mb-3">
            <h5 class="fw-bold mb-0">🎄 Adventi naptár</h5>
            <div class="text-muted small">${preview ? `Előnézet – ${day}. nap` : christmas ? 'Boldog karácsonyt! Minden ablak kinyitható.' : 'Minden nap egy újabb ablak!'}</div>
        </div>
        <div class="advent-grid" id="advGrid"></div>
        <div class="advent-msg hidden" id="advMsg"></div>
        <button class="btn btn-light w-100 mt-3" id="advClose">Bezárás</button>`);

    const grid = $('#advGrid', sheet);
    const msgBox = $('#advMsg', sheet);

    const show = (i) => {
        msgBox.innerHTML = `<div class="advent-msg-day">${i}. nap</div><div>${esc(messages[i - 1])}</div>`;
        msgBox.classList.remove('hidden');
        msgBox.classList.remove('pop'); void msgBox.offsetWidth; msgBox.classList.add('pop');
    };

    const render = () => {
        grid.innerHTML = Array.from({ length: 24 }, (_, k) => {
            const i = k + 1;
            const state = i > day ? 'locked' : opened.includes(i) ? 'opened' : 'ready';
            return `<button class="advent-day ${state} ${i === day && state === 'ready' ? 'today' : ''}" data-day="${i}">
                ${state === 'opened' ? '<span class="advent-gift">🎁</span>' : ''}<span class="advent-num">${i}</span>
            </button>`;
        }).join('');
    };

    grid.addEventListener('click', (e) => {
        const b = e.target.closest('[data-day]');
        if (!b) return;
        const i = Number(b.dataset.day);
        if (i > day) { feedback('error'); return toast('Ezt még nem nyithatod ki! 🛑'); }
        feedback('success');
        if (!opened.includes(i)) {
            opened = [...opened, i];
            saveOpened(key, opened);
            render();
        }
        show(i);
    });

    $('#advClose', sheet).addEventListener('click', () => sheet.closest('.overlay')?.classList.remove('open'));
    render();
    if (opened.includes(day)) show(day);
};

// ---------- Hóesés ----------
let snowTimer = null;
export const startSnow = () => {
    if (snowTimer || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.createElement('div');
    layer.className = 'snow-layer';
    document.body.appendChild(layer);
    snowTimer = setInterval(() => {
        if (document.visibilityState !== 'visible' || layer.childElementCount > 18) return;
        const f = document.createElement('span');
        f.className = 'snowflake';
        f.textContent = '❄';
        f.style.left = `${Math.random() * 100}vw`;
        f.style.fontSize = `${0.7 + Math.random() * 0.8}rem`;
        f.style.animationDuration = `${6 + Math.random() * 5}s`;
        layer.appendChild(f);
        f.addEventListener('animationend', () => f.remove());
    }, 700);
};
