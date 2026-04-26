import Logger from './logger';

// Open-Meteo — completely free, no API key needed, no account required
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Showers', 81: 'Rain showers', 82: 'Violent showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail',
};

const WMO_EMOJI = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '❄️', 75: '❄️',
  80: '🌦', 81: '🌧', 82: '⛈',
  95: '⛈', 96: '⛈',
};

export async function getWeatherByCity(city) {
  Logger.info('Weather', 'Fetching weather for city', { city });
  try {
    // Step 1: Geocode city name
    const geoRes = await fetch(`${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    const geoData = await geoRes.json();
    const loc = geoData.results?.[0];
    if (!loc) { Logger.warn('Weather', 'City not found', { city }); return null; }

    return fetchWeather(loc.latitude, loc.longitude, loc.name, loc.country);
  } catch (e) {
    Logger.error('Weather', 'getWeatherByCity failed', e);
    return null;
  }
}

export async function getWeatherByCoords(lat, lon) {
  Logger.info('Weather', 'Fetching weather by coords', { lat, lon });
  try {
    return fetchWeather(lat, lon, 'Your location', '');
  } catch (e) {
    Logger.error('Weather', 'getWeatherByCoords failed', e);
    return null;
  }
}

async function fetchWeather(lat, lon, city, country) {
  const url = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relativehumidity_2m&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1&timezone=auto`;
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
  const condition = WMO_CODES[code] || 'Unknown';
  const emoji = WMO_EMOJI[code] || '🌡';

  const result = {
    city, country, temp, feelsLike, humidity, wind,
    high, low, rainChance, condition, emoji, code,
    summary: `${emoji} ${condition}, ${temp}°F (feels ${feelsLike}°F), H:${high}° L:${low}°, ${rainChance}% rain`,
    dressingAdvice: getDressingAdvice(temp, feelsLike, code, rainChance, wind),
  };

  Logger.info('Weather', 'Weather fetched', { city, temp, condition });
  return result;
}

function getDressingAdvice(temp, feelsLike, code, rainChance, wind) {
  const advice = [];
  if (feelsLike < 32) advice.push('Heavy coat, gloves, scarf essential');
  else if (feelsLike < 45) advice.push('Warm jacket or coat needed');
  else if (feelsLike < 60) advice.push('Light jacket or layer up');
  else if (feelsLike < 75) advice.push('Light clothing, maybe a light jacket for evening');
  else advice.push('Light breathable clothing');

  if (rainChance > 60) advice.push('Bring an umbrella or wear waterproof layer');
  else if (rainChance > 30) advice.push('Consider a light waterproof layer');

  if (wind > 20) advice.push('Windy — avoid loose/flowy clothing');
  if ([95, 96, 80, 81, 82].includes(code)) advice.push('Rain gear strongly recommended');

  return advice.join('. ');
}
