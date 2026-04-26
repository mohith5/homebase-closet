import Logger from './logger';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — no API call if fresh

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

const WMO_CODES = {
  0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
  45:'Foggy',48:'Icy fog',
  51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
  61:'Light rain',63:'Rain',65:'Heavy rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',80:'Showers',81:'Rain showers',82:'Violent showers',
  95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm',
};
const WMO_EMOJI = {
  0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',
  51:'🌦',53:'🌦',55:'🌧',61:'🌧',63:'🌧',65:'🌧',
  71:'🌨',73:'❄️',75:'❄️',80:'🌦',81:'🌧',82:'⛈',
  95:'⛈',96:'⛈',99:'⛈',
};

// Severe weather codes that trigger an alert
const SEVERE_CODES = new Set([82, 95, 96, 99]);
const RAIN_CODES = new Set([51,53,55,61,63,65,80,81,82]);
const SNOW_CODES = new Set([71,73,75]);

async function getCached(key) {
  try {
    const raw = await AsyncStorage.getItem('@hbc_weather_' + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) { await AsyncStorage.removeItem('@hbc_weather_' + key); return null; }
    Logger.info('Weather', `Cache hit for ${key} (${Math.round((Date.now()-ts)/60000)}min old)`);
    return data;
  } catch { return null; }
}

async function setCache(key, data) {
  try { await AsyncStorage.setItem('@hbc_weather_' + key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

export async function getWeatherByCity(city) {
  const cacheKey = `city_${city.toLowerCase().replace(/\s/g,'_')}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  Logger.info('Weather', 'Fetching weather for city', { city });
  try {
    const geoRes = await fetch(`${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    const geoData = await geoRes.json();
    const loc = geoData.results?.[0];
    if (!loc) { Logger.warn('Weather', 'City not found', { city }); return null; }
    const result = await fetchWeather(loc.latitude, loc.longitude, loc.name, loc.country);
    await setCache(cacheKey, result);
    return result;
  } catch (e) {
    Logger.error('Weather', 'getWeatherByCity failed', e);
    return null;
  }
}

export async function getWeatherByCoords(lat, lon) {
  const cacheKey = `coords_${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  Logger.info('Weather', 'Fetching weather by coords', { lat, lon });
  try {
    const result = await fetchWeather(lat, lon, 'Your location', '');
    await setCache(cacheKey, result);
    return result;
  } catch (e) {
    Logger.error('Weather', 'getWeatherByCoords failed', e);
    return null;
  }
}

async function fetchWeather(lat, lon, city, country) {
  const url = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relativehumidity_2m,precipitation&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max,windgusts_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=3&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  const c = data.current;
  const d = data.daily;

  const code = c.weathercode;
  const temp = Math.round(c.temperature_2m);
  const feelsLike = Math.round(c.apparent_temperature);
  const humidity = c.relativehumidity_2m;
  const wind = Math.round(c.windspeed_10m);
  const high = Math.round(d.temperature_2m_max?.[0]);
  const low = Math.round(d.temperature_2m_min?.[0]);
  const rainChance = d.precipitation_probability_max?.[0] || 0;
  const windGusts = Math.round(d.windgusts_10m_max?.[0] || 0);
  const condition = WMO_CODES[code] || 'Unknown';
  const emoji = WMO_EMOJI[code] || '🌡';

  const alerts = buildAlerts(code, temp, feelsLike, rainChance, wind, windGusts);

  const result = {
    city, country, temp, feelsLike, humidity, wind, windGusts,
    high, low, rainChance, condition, emoji, code,
    alerts, // array of { level: 'warning'|'danger', message: string }
    summary: `${emoji} ${condition}, ${temp}°F (feels ${feelsLike}°F), H:${high}° L:${low}°, ${rainChance}% rain`,
    dressingAdvice: getDressingAdvice(temp, feelsLike, code, rainChance, wind),
    // Next 2 days for trip planning
    forecast: [1, 2].map(i => ({
      high: Math.round(d.temperature_2m_max?.[i] || 0),
      low: Math.round(d.temperature_2m_min?.[i] || 0),
      code: d.weathercode?.[i] || 0,
      emoji: WMO_EMOJI[d.weathercode?.[i]] || '🌡',
      condition: WMO_CODES[d.weathercode?.[i]] || '',
      rainChance: d.precipitation_probability_max?.[i] || 0,
    }))
  };

  Logger.info('Weather', 'Fetched', { city, temp, condition, alerts: alerts.length });
  return result;
}

function buildAlerts(code, temp, feelsLike, rainChance, wind, windGusts) {
  const alerts = [];
  if (SEVERE_CODES.has(code)) alerts.push({ level:'danger', message:'⛈ Severe thunderstorm — avoid outdoor activities' });
  if (SNOW_CODES.has(code) && temp < 32) alerts.push({ level:'danger', message:'❄️ Snow and freezing temps — roads may be icy, dress warmly' });
  if (feelsLike < 20) alerts.push({ level:'danger', message:'🥶 Dangerous wind chill — limit time outdoors' });
  if (feelsLike > 100) alerts.push({ level:'danger', message:'🔥 Extreme heat — risk of heat exhaustion, stay hydrated' });
  if (rainChance > 80 && RAIN_CODES.has(code)) alerts.push({ level:'warning', message:`🌧 High rain chance (${rainChance}%) — bring waterproof layer and umbrella` });
  if (windGusts > 45) alerts.push({ level:'warning', message:`💨 High wind gusts (${windGusts}mph) — avoid loose/flowy clothing, check for road closures` });
  if (feelsLike < 32) alerts.push({ level:'warning', message:'🧊 Below freezing — layer up, protect extremities' });
  if (feelsLike > 90) alerts.push({ level:'warning', message:'☀️ Very hot — wear lightweight breathable fabrics, bring water' });
  return alerts;
}

function getDressingAdvice(temp, feelsLike, code, rainChance, wind) {
  const advice = [];
  if (feelsLike < 32) advice.push('Heavy coat, gloves, scarf essential');
  else if (feelsLike < 45) advice.push('Warm jacket or coat needed');
  else if (feelsLike < 60) advice.push('Light jacket or layer up');
  else if (feelsLike < 75) advice.push('Light clothing, maybe a light jacket for evening');
  else advice.push('Light breathable clothing');
  if (rainChance > 60) advice.push('Bring umbrella or waterproof layer');
  else if (rainChance > 30) advice.push('Consider a light waterproof layer');
  if (wind > 20) advice.push('Windy — avoid loose/flowy clothing');
  if (SEVERE_CODES.has(code)) advice.push('⚠️ Severe weather — stay indoors if possible');
  return advice.join('. ');
}
