/* Interaction tests for glasshouse-climate-card, run with node + jsdom (not a repo dependency):
 *   mkdir /tmp/ghtest && cd /tmp/ghtest && npm i jsdom
 *   node /path/to/repo/test/interaction.test.cjs
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(require.resolve('jsdom', { paths: [process.cwd(), __dirname] }));

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed += 1; console.log('  ✓', msg); }
  else { failed += 1; console.log('  ✗', msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`); }

// Dial geometry, mirrored from the card: viewBox 240, centre 120,120, radius 92, arc 135°..405°.
const CX = 120, CY = 120, R = 92;
function pointFor(value, min, max) {
  const a = ((135 + 270 * ((value - min) / (max - min))) * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
}

function setup(config, opts) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(`
    if (!window.PointerEvent) {
      window.PointerEvent = class PointerEvent extends MouseEvent {
        constructor(t, i) { super(t, i); this.pointerId = (i && i.pointerId) || 1; this.pointerType = (i && i.pointerType) || 'touch'; }
      };
    }
    customElements.define('ha-card', class extends HTMLElement {});
    customElements.define('ha-icon', class extends HTMLElement {});
  `);
  w.console.info = () => {};
  w.eval(read('test/mock-hass.js'));
  w.eval(read('glasshouse-climate-card.js'));
  const mock = w.GHMock.createHass(undefined, opts);
  const card = w.document.createElement('glasshouse-climate-card');
  card.setConfig(config || {
    entity: 'climate.zone_a', name: 'Zone', humidity: 'sensor.zone_a_humidity', outside: 'sensor.outdoor_temp',
    rooms: [{ entity: 'sensor.room_1', name: 'A' }, { entity: 'sensor.room_2', name: 'B' },
      { entity: 'sensor.room_3', name: 'C' }, { entity: 'sensor.room_8', name: 'D' }],
    show_fan: true,
  });
  w.document.body.append(card);
  mock.subscribe((hass) => { card.hass = hass; });
  const $ = (sel) => card.shadowRoot.querySelector(sel);
  const $$ = (sel) => [...card.shadowRoot.querySelectorAll(sel)];
  const svg = $('svg');
  // jsdom has no layout: pretend the dial is drawn 1:1 at the origin.
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 240, right: 240, bottom: 240 });
  const ptr = (type, x, y) => svg.dispatchEvent(new w.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
  const hero = () => $('.hero').textContent.replace(/\s+/g, '');
  const setTemps = () => mock.calls.filter((c) => c.service === 'set_temperature');
  return { w, mock, card, $, $$, ptr, hero, setTemps };
}

(async () => {
  console.log('render');
  {
    const { $, $$, card, hero } = setup();
    eq(hero(), '70°', 'hero shows the setpoint');
    eq($('.lbl').textContent, 'Heat to', 'label for heat mode');
    eq($('.status .act').textContent, 'Heating', 'hvac_action shown');
    eq($('.now').textContent, 'Now 67.6°', 'current temperature under the setpoint');
    eq($('ha-card').dataset.tone, 'heat', 'accent follows heating');
    ok($('ha-card').classList.contains('active'), 'active glow while heating');
    eq($$('.mode').map((b) => b.dataset.mode), ['heat', 'cool', 'heat_cool', 'off'], 'mode buttons from hvac_modes');
    eq($('.mode[data-mode="heat"]').getAttribute('aria-pressed'), 'true', 'current mode pressed');
    eq($$('.fopt').map((b) => b.dataset.fan), ['auto', 'low', 'high'], 'fan chips when show_fan');
    eq($('.chip.hum').textContent, '43%', 'humidity chip');
    ok($('.chip.out').textContent.includes('58°'), 'outside chip');
    ok($('.thumb[data-thumb="temp"]').style.display !== 'none', 'single thumb shown');
    ok($('.thumb[data-thumb="low"]').style.display === 'none', 'dual thumbs hidden');
    eq(card.getGridOptions(), { columns: 12, min_columns: 6, rows: 'auto' }, 'getGridOptions');
  }

  console.log('drag -> debounced set_temperature');
  {
    const { ptr, hero, setTemps, mock } = setup();
    ptr('pointerdown', ...pointFor(72, 50, 90));
    eq(hero(), '72°', 'value follows the finger immediately');
    ptr('pointermove', ...pointFor(73.3, 50, 90));
    eq(hero(), '73°', 'snaps to whole degrees (target_temp_step 1)');
    await sleep(500);
    ptr('pointermove', ...pointFor(74.2, 50, 90));
    eq(hero(), '74°', 'still local while dragging');
    eq(setTemps().length, 0, 'no call while the value keeps changing');
    await sleep(500);
    eq(setTemps().length, 0, 'no call 500 ms after the last change');
    ptr('pointerup', ...pointFor(74.2, 50, 90));
    await sleep(400);
    eq(setTemps().length, 1, 'exactly one call ~800 ms after the last change');
    eq(setTemps()[0].data, { entity_id: 'climate.zone_a', temperature: 74 }, 'service data');
    eq(mock.current.states['climate.zone_a'].attributes.temperature, 74, 'mock state updated');
    eq(hero(), '74°', 'shows new setpoint');
  }

  console.log('target shown until state catches up');
  {
    const { $, hero, setTemps, mock } = setup(undefined, { delay: 300 });
    $('.step[aria-label^="Raise"]').click();
    $('.step[aria-label^="Raise"]').click();
    eq(hero(), '72°', '+ twice is local 72');
    await sleep(850);
    eq(setTemps().length, 1, 'one call for two clicks');
    eq(setTemps()[0].data.temperature, 72, 'call carries 72');
    mock.setState('sensor.room_1', '66.0'); // unrelated update before the device reports
    eq(hero(), '72°', 'target kept while the entity still says 70');
    await sleep(350);
    eq(mock.current.states['climate.zone_a'].attributes.temperature, 72, 'device caught up');
    eq(hero(), '72°', 'still 72 once caught up');
  }

  console.log('step snapping');
  {
    const snap = (() => { const d = new JSDOM('', { runScripts: 'outside-only' }); const w = d.window;
      w.eval("customElements.define('ha-card', class extends HTMLElement {}); console.info = () => {};");
      w.eval(read('glasshouse-climate-card.js')); return w.customElements.get('glasshouse-climate-card')._snap; })();
    eq(snap(21.37, 0.5, 7, 30), 21.5, '21.37 -> 21.5 at step 0.5');
    eq(snap(21.2, 0.5, 7, 30), 21, '21.2 -> 21 at step 0.5');
    eq(snap(70.6, 1, 50, 90), 71, '70.6 -> 71 at step 1');
    eq(snap(5, 0.5, 7, 30), 7, 'clamps to min');
    eq(snap(72.04, 0.1, 50, 90), 72, 'step 0.1 without float noise');
    const { ptr, hero, setTemps } = setup({ entity: 'climate.zone_b' });
    ptr('pointerdown', ...pointFor(72.6, 50, 90));
    ptr('pointerup', ...pointFor(72.6, 50, 90));
    eq(hero(), '72.5°', 'drag on a 0.5-step entity snaps to 72.5');
    await sleep(850);
    eq(setTemps()[0].data.temperature, 72.5, 'call carries 72.5');
  }

  console.log('heat_cool: two thumbs');
  {
    const { $, ptr, hero, setTemps, mock } = setup({ entity: 'climate.zone_c' });
    eq(hero(), '68°–75°', 'shows both setpoints');
    eq($('.lbl').textContent, 'Keep between', 'dual label');
    ok($('.thumb[data-thumb="low"]').style.display !== 'none' && $('.thumb[data-thumb="high"]').style.display !== 'none', 'two thumbs');
    eq($('ha-card').dataset.tone, 'dual', 'dual accent');
    ptr('pointerdown', ...pointFor(66.4, 50, 90)); // nearer the low thumb
    ptr('pointermove', ...pointFor(65, 50, 90));
    ptr('pointerup', ...pointFor(65, 50, 90));
    eq(hero(), '65°–75°', 'low thumb dragged');
    ptr('pointerdown', ...pointFor(76, 50, 90)); // nearer the high thumb
    ptr('pointermove', ...pointFor(66, 50, 90)); // try to cross low
    ptr('pointerup', ...pointFor(66, 50, 90));
    eq(hero(), '65°–67°', 'high cannot cross low (2° gap)');
    await sleep(850);
    eq(setTemps().length, 1, 'one call for both thumbs');
    eq(setTemps()[0].data, { entity_id: 'climate.zone_c', target_temp_low: 65, target_temp_high: 67 }, 'low/high service data');
    eq(mock.current.states['climate.zone_c'].attributes.target_temp_high, 67, 'mock updated');
    $('.hero .num.lo').click();
    $('.step[aria-label^="Raise"]').click();
    eq(hero(), '65°–67°', '+ on low blocked by the gap');
    $('.step[aria-label^="Lower"]').click();
    eq(hero(), '64°–67°', '- moves the selected (low) thumb');
  }

  console.log('mode change');
  {
    const { $, mock } = setup();
    let haptic = 0;
    $('ha-card').getRootNode().host.addEventListener('haptic', () => { haptic += 1; });
    $('.mode[data-mode="cool"]').click();
    eq(mock.calls.at(-1), { domain: 'climate', service: 'set_hvac_mode', data: { entity_id: 'climate.zone_a', hvac_mode: 'cool' } }, 'set_hvac_mode called');
    eq($('.mode[data-mode="cool"]').getAttribute('aria-pressed'), 'true', 'cool pressed');
    eq($('ha-card').dataset.tone, 'cool', 'accent switches to cool');
    eq($('.lbl').textContent, 'Cool to', 'label follows');
    eq(haptic, 1, 'haptic on mode change');
    $('.mode[data-mode="heat_cool"]').click();
    ok($('.thumb[data-thumb="low"]').style.display !== 'none', 'heat_cool shows two thumbs');
    $('.mode[data-mode="off"]').click();
    eq($('.lbl').textContent, 'Indoor', 'off shows indoor temperature');
    eq($('ha-card').dataset.tone, 'off', 'off is neutral');
    ok($('.step').hidden, 'steppers hidden when off');
    $('.fopt[data-fan="high"]').click();
    eq(mock.calls.at(-1).service, 'set_fan_mode', 'fan chip calls set_fan_mode');
  }

  console.log('room colour scale');
  {
    const { $ } = setup();
    const room = (id) => $(`.room[data-entity="${id}"]`);
    // setpoint 70°F, scale 2°
    eq([room('sensor.room_1').dataset.tone, room('sensor.room_1').dataset.k], ['cool', '1'], '66.2 (−3.8) is fully cool');
    eq(room('sensor.room_1').querySelector('.dl').textContent, '−3.8°', 'negative delta label');
    eq(room('sensor.room_2').dataset.tone, 'neutral', '69.6 (−0.4) is neutral');
    eq([room('sensor.room_3').dataset.tone, room('sensor.room_3').dataset.k], ['warm', '0.6'], '71.4 (+1.4) is partly warm');
    eq(room('sensor.room_3').querySelector('.dl').textContent, '+1.4°', 'positive delta label');
    ok(room('sensor.room_8').classList.contains('unavail'), 'unavailable room dimmed');
    const tone = $('ha-card').getRootNode().host.constructor._toneFor;
    eq(tone(-2, 2), { tone: 'cool', k: 1 }, '≥2° below = cool');
    eq(tone(2.5, 2), { tone: 'warm', k: 1 }, '≥2° above = warm');
    eq(tone(0.3, 2), { tone: 'neutral', k: 0 }, 'near = neutral');
    const d = setup({ entity: 'climate.zone_c', rooms: ['sensor.room_2', 'sensor.room_7', 'sensor.room_1'] });
    const r = (id) => d.$(`.room[data-entity="${id}"]`);
    eq(r('sensor.room_2').querySelector('.dl').textContent, 'In range', 'heat_cool: inside the band');
    eq(r('sensor.room_7').querySelector('.dl').textContent, '+1.9°', 'heat_cool: delta to the high bound');
    eq(r('sensor.room_1').querySelector('.dl').textContent, '−1.8°', 'heat_cool: delta to the low bound');
    eq(r('sensor.room_2').querySelector('.nm').textContent, 'Living Room', 'room name from friendly_name');
  }

  console.log('keyboard range input');
  {
    const { $, setTemps } = setup();
    const inp = $('input[data-thumb="temp"]');
    ok(!inp.hidden && inp.getAttribute('aria-label'), 'labelled range input');
    eq([inp.min, inp.max, inp.step], ['50', '90', '1'], 'range attrs');
    inp.value = '68';
    inp.dispatchEvent(new inp.ownerDocument.defaultView.Event('input'));
    await sleep(850);
    eq(setTemps()[0].data.temperature, 68, 'range input -> debounced call');
  }

  console.log('unavailable');
  {
    const { $, ptr, mock, hero } = setup({ entity: 'climate.zone_e', rooms: ['sensor.room_1'] });
    ok($('ha-card').classList.contains('unavail'), 'card dimmed');
    eq(hero(), '—', 'dash instead of a setpoint');
    eq($('.status .act').textContent, 'Unavailable', 'status text');
    ok(!$('.badge').hidden, 'alert badge');
    ptr('pointerdown', ...pointFor(70, 50, 90));
    $('.step').click();
    await sleep(850);
    eq(mock.calls.length, 0, 'no service calls');
  }

  console.log('diffing and config');
  {
    const { card, mock } = setup();
    const n = card._renders;
    card.hass = { ...mock.current };          // same state objects
    eq(card._renders, n, 'no re-render when watched states are identical');
    mock.setState('sensor.not_watched', 'x');
    eq(card._renders, n, 'unwatched change ignored');
    mock.setState('sensor.room_2', '70.0');
    eq(card._renders, n + 1, 're-render when a room changes');
    const bad = (cfg) => { try { card.setConfig(cfg); return false; } catch (e) { return /glasshouse-climate-card/.test(e.message); } };
    ok(bad({}), 'missing entity rejected');
    ok(bad({ entity: 'sensor.x' }), 'non-climate entity rejected');
    ok(bad({ entity: 'climate.x', rooms: [{ name: 'x' }] }), 'room without entity rejected');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
