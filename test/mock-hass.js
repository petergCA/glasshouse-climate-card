/* Mock Home Assistant `hass` for the Glasshouse climate card harness and node tests.
 * Generic demo data only. callService mutates the mock state (new state object per change,
 * like HA) and hands a fresh hass object to every subscriber. Climate entities support
 * heat / cool / heat_cool / off, set_temperature, set_hvac_mode and set_fan_mode. */
(function (root) {
  'use strict';

  function s(entity_id, state, attributes) {
    return {
      entity_id, state, attributes: attributes || {},
      last_changed: '2026-01-01T00:00:00Z', last_updated: '2026-01-01T00:00:00Z', context: { id: 'x' },
    };
  }

  const MODES = ['off', 'heat', 'cool', 'heat_cool'];
  const FAN = ['auto', 'low', 'high'];

  function thermostat(id, name, state, extra) {
    return s(id, state, {
      friendly_name: name, hvac_modes: MODES, min_temp: 50, max_temp: 90, target_temp_step: 1,
      fan_modes: FAN, fan_mode: 'auto', temperature: null, target_temp_low: null, target_temp_high: null,
      ...extra,
    });
  }
  const temp = (id, v, name) => s(id, String(v), { unit_of_measurement: '°F', device_class: 'temperature', friendly_name: name });

  function demoStates() {
    const list = [
      thermostat('climate.zone_a', 'Downstairs', 'heat', { temperature: 70, current_temperature: 67.6, hvac_action: 'heating', current_humidity: 41 }),
      thermostat('climate.zone_b', 'Upstairs', 'cool', { temperature: 72, current_temperature: 75.4, hvac_action: 'cooling', target_temp_step: 0.5 }),
      thermostat('climate.zone_c', 'Studio', 'heat_cool', { target_temp_low: 68, target_temp_high: 75, current_temperature: 71.2, hvac_action: 'idle' }),
      thermostat('climate.zone_d', 'Guest Suite', 'off', { current_temperature: 64.3, hvac_action: 'off' }),
      s('climate.zone_e', 'unavailable', { friendly_name: 'Garage', restored: true }),
      s('climate.zone_m', 'heat', { friendly_name: 'Basement', hvac_modes: ['off', 'heat'], min_temp: 7, max_temp: 30,
        target_temp_step: 0.5, temperature: 20.5, current_temperature: 19.2, hvac_action: 'heating', temperature_unit: '°C' }),

      s('sensor.zone_a_humidity', '43', { unit_of_measurement: '%', device_class: 'humidity' }),
      s('sensor.outdoor_temp', '57.8', { unit_of_measurement: '°F', device_class: 'temperature' }),

      temp('sensor.room_1', 66.2, 'Kitchen'),
      temp('sensor.room_2', 69.6, 'Living Room'),
      temp('sensor.room_3', 71.4, 'Office'),
      temp('sensor.room_4', 68.8, 'Dining'),
      temp('sensor.room_5', 73.1, 'Primary Bedroom'),
      temp('sensor.room_6', 74.6, 'Kids Room'),
      temp('sensor.room_7', 76.9, 'Loft'),
      s('sensor.room_8', 'unavailable', { unit_of_measurement: '°F', device_class: 'temperature', friendly_name: 'Bath' }),
    ];
    const states = {};
    for (const x of list) states[x.entity_id] = x;
    return states;
  }

  function createHass(initialStates, opts) {
    const subscribers = new Set();
    const calls = [];
    let states = initialStates || demoStates();
    const delay = opts && opts.delay;

    function commit(id, mutate) {
      const prev = states[id];
      if (!prev) return;
      const next = { ...prev, attributes: { ...prev.attributes }, last_updated: new Date().toISOString() };
      mutate(next, next.attributes);
      states = { ...states, [id]: next };
      publish();
    }

    function publish() {
      const hass = makeHass();
      api.current = hass;
      subscribers.forEach((fn) => fn(hass));
    }

    function action(st, a) {
      const cur = a.current_temperature;
      if (st.state === 'off') return 'off';
      if (st.state === 'heat') return cur < a.temperature ? 'heating' : 'idle';
      if (st.state === 'cool') return cur > a.temperature ? 'cooling' : 'idle';
      if (st.state === 'heat_cool') return cur < a.target_temp_low ? 'heating' : cur > a.target_temp_high ? 'cooling' : 'idle';
      return 'idle';
    }

    function apply(domain, service, data) {
      const ids = [].concat(data.entity_id || []);
      for (const id of ids) {
        commit(id, (st, a) => {
          if (st.state === 'unavailable') return;
          if (domain !== 'climate') return;
          if (service === 'set_temperature') {
            if (data.temperature !== undefined) a.temperature = data.temperature;
            if (data.target_temp_low !== undefined) a.target_temp_low = data.target_temp_low;
            if (data.target_temp_high !== undefined) a.target_temp_high = data.target_temp_high;
          }
          if (service === 'set_hvac_mode') {
            const prev = st.state;
            st.state = data.hvac_mode;
            if (st.state === 'heat_cool') {
              const base = a.temperature != null ? a.temperature : 70;
              a.target_temp_low = a.target_temp_low != null ? a.target_temp_low : base - 2;
              a.target_temp_high = a.target_temp_high != null ? a.target_temp_high : base + 3;
              a.temperature = null;
            } else if (st.state === 'heat' || st.state === 'cool') {
              if (a.temperature == null) {
                a.temperature = prev === 'heat_cool' && a.target_temp_low != null
                  ? (st.state === 'heat' ? a.target_temp_low : a.target_temp_high) : 70;
              }
              a.target_temp_low = null; a.target_temp_high = null;
            }
          }
          if (service === 'set_fan_mode') a.fan_mode = data.fan_mode;
          if ('hvac_action' in a) a.hvac_action = action(st, a);
        });
      }
    }

    function makeHass() {
      return {
        states,
        user: { name: 'Demo' },
        language: 'en',
        config: { unit_system: { temperature: '°F' } },
        callService(domain, service, data) {
          calls.push({ domain, service, data: JSON.parse(JSON.stringify(data || {})) });
          if (!delay) apply(domain, service, data || {});
          else setTimeout(() => apply(domain, service, data || {}), delay);
          return Promise.resolve();
        },
      };
    }

    const api = {
      calls,
      current: makeHass(),
      subscribe(fn) { subscribers.add(fn); fn(api.current); return () => subscribers.delete(fn); },
      setState(id, state, attrs) { commit(id, (st, a) => { st.state = state; Object.assign(a, attrs || {}); }); },
      touch() { publish(); },
    };
    return api;
  }

  root.GHMock = { demoStates, createHass };
})(typeof window !== 'undefined' ? window : globalThis);
