import { supabase } from './supabase';
import Logger from './logger';

const EDGE_FN_URL = 'https://wpzgcwvjzhzurmbirdsj.supabase.co/functions/v1/closet-ai';

const MODELS = {
  fast:  'claude-haiku-4-5-20251001',  // vision scanning, simple tasks
  smart: 'claude-sonnet-4-6',          // outfit generation, complex reasoning
};

// ─── Usage tracking ───────────────────────────────────────────
const MONTHLY_SOFT_CAP = 100;

async function getMonthlyUsage() {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const { data } = await supabase.from('closet_ai_usage').select('calls').eq('month', month).maybeSingle();
    return data?.calls || 0;
  } catch { return 0; }
}

async function incrementUsage() {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const { data } = await supabase.from('closet_ai_usage').select('id,calls').eq('month', month).maybeSingle();
    if (data) {
      await supabase.from('closet_ai_usage').update({ calls: data.calls + 1 }).eq('id', data.id);
    } else {
      await supabase.from('closet_ai_usage').insert({ month, calls: 1 });
    }
  } catch (e) { Logger.warn('Claude', 'Usage increment failed', e); }
}

// ─── Core caller ─────────────────────────────────────────────
export async function callClaude({ system, messages, max_tokens = 2048, model = MODELS.smart }, retries = 2) {
  const done = Logger.perf('Claude', `callClaude(${model})`);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const usage = await getMonthlyUsage();
  if (usage >= MONTHLY_SOFT_CAP) throw new Error(`Monthly AI limit reached (${usage} calls). Resets next month.`);

  Logger.info('Claude', 'Calling AI', { model, usage: `${usage}/${MONTHLY_SOFT_CAP}` });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ model, max_tokens, system, messages }),
      });

      if (!res.ok) {
        const errText = await res.text();
        Logger.error('Claude', `HTTP ${res.status} attempt ${attempt + 1}`, errText);
        if (attempt < retries && (res.status >= 500 || res.status === 503)) {
          const delay = res.status === 503 ? 3000 + attempt * 1000 : Math.pow(2, attempt) * 800;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Claude API error: ${res.status}`);
      }

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      Logger.info('Claude', `OK — ${text.length} chars | in:${data.usage?.input_tokens} out:${data.usage?.output_tokens} cache_read:${data.usage?.cache_read_input_tokens ?? 0}`);
      await incrementUsage();
      done();
      return text;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 800));
    }
  }
}

export function parseClaudeJSON(text) {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    Logger.error('Claude', 'JSON parse failed', { preview: text.slice(0, 200) });
    throw new Error('Could not parse AI response');
  }
}

// ─── Vision: scan outfit photo → items + bounding boxes ──────
// Uses Haiku (not Sonnet) — fast, cheap, good enough for detection
// Cache_control on the static system prompt = hits cache on every photo scan
const SCAN_SYSTEM = `You are a computer vision expert and fashion analyst. Detect every clothing item and accessory CLEARLY VISIBLE in the photo.

For each item return its bounding box in % coordinates (0-100) from top-left.

RULES:
- Only items you are 90%+ confident are present
- Ignore face and skin
- Detect brand logos, labels, text
- Bounding box TIGHTLY surrounds the item only

Return ONLY valid JSON array:
[{
  "name": "brand+model e.g. Nike Air Force 1 White",
  "category": "Tops|Bottoms|Dresses|Outerwear|Shoes|Jewelry|Watches|Bags|Hats|Belts|Sunglasses|Activewear|Swimwear|Loungewear",
  "color": "primary color",
  "colors": ["all colors"],
  "material": "if identifiable",
  "fit": "slim|regular|loose|oversized|tailored",
  "brand": "if visible",
  "model": "if identifiable",
  "fingerprint": "unique-slug-for-dedup e.g. nike-af1-white-low",
  "bbox": { "left": 0, "top": 0, "width": 0, "height": 0 }
}]`;

export async function splitOutfitIntoItems(base64, mimeType = 'image/jpeg') {
  Logger.info('Claude', 'Scanning outfit photo (Haiku)');
  const text = await callClaude({
    model: MODELS.fast, // Haiku — ~10x cheaper than Sonnet, handles this well
    system: [{ type: 'text', text: SCAN_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
      { type: 'text', text: 'Detect all clothing items and accessories. Return JSON only.' },
    ]}],
    max_tokens: 1500,
  });
  const parsed = parseClaudeJSON(text);
  const items = Array.isArray(parsed) ? parsed : parsed.items || [];
  Logger.info('Claude', `Detected ${items.length} items`);
  return items;
}

// ─── Outfit generation ────────────────────────────────────────
// Cache strategy:
//   Block 1 (cached): static Stylie persona + rules + response format  ← never changes
//   Block 2 (cached): profile + wardrobe                               ← changes when wardrobe changes
//   User message: occasion + weather                                    ← always fresh, tiny
//
// Result: on repeated calls (same wardrobe), blocks 1+2 are cache hits.
// Only the small user message is billed at full rate. ~85% cost saving.

const OUTFIT_PERSONA = `You are Stylie — an elite personal AI stylist with the knowledge of a Vogue editor, a personal shopper, and a fashion psychologist combined.

━━ RULES ━━
1. ONLY use items from the wardrobe provided in the next message
2. If wardrobe is empty, suggest outfit concepts based on style profile
3. NEVER repeat the same combination
4. Each outfit MUST be weather-appropriate
5. Apply color theory: complementary colors, skin tone contrast, seasonal palette
6. Flatter the body type with appropriate fits and cuts
7. Include accessories if available (jewelry, watches, bags, belts)
8. Return ONLY valid JSON — no markdown, no text outside JSON

━━ RESPONSE FORMAT ━━
{
  "weather_note": "one sentence on how weather shaped these choices",
  "trend_note": "one sentence on current trend applied",
  "outfits": [
    {
      "name": "Creative outfit name",
      "tagline": "Short punchy descriptor",
      "description": "2 sentence description of the look and why it works",
      "items": ["exact item names from wardrobe"],
      "colors": ["color names in this outfit"],
      "occasion_fit": "why this works for the occasion",
      "weather_fit": "why this is right for the weather",
      "why_it_works": "color theory + body type + skin tone explanation",
      "styling_tip": "one specific tip to elevate this look",
      "confidence": 8
    }
  ],
  "hair": {
    "suggestion": "Specific hairstyle achievable with their tools",
    "how_to": "Step-by-step using ONLY tools they own",
    "time_needed": "e.g. 10 mins",
    "cap_recommendation": "Should they wear a cap today? Yes/No and why",
    "why": "Why this works for the occasion, weather, and hair type"
  },
  "avoid_today": "What NOT to wear today and why",
  "shopping_gap": "One missing item that would elevate these looks"
}`;

export async function generateOutfits({ profile, wardrobeItems, occasion, location, weather, previousOutfitIds = [] }, extraSuggestions = false) {
  Logger.info('Claude', 'Generating outfits', { occasion, wardrobeCount: wardrobeItems.length, extraSuggestions });

  const wardrobeText = wardrobeItems.length > 0
    ? wardrobeItems.map((i, idx) =>
        `[${idx}] ${i.name || i.category}: ${i.color} ${i.category}${i.fit ? `, ${i.fit} fit` : ''}${i.material ? `, ${i.material}` : ''}${i.brand ? ` (${i.brand})` : ''}${i.occasions?.length ? ` — worn for: ${i.occasions.join('/')}` : ''}`
      ).join('\n')
    : 'Wardrobe is empty — suggest ideal outfit concepts based on style profile.';

  const weatherContext = weather
    ? `${weather.summary}\nDressing advice: ${weather.dressingAdvice}`
    : 'Mild conditions, no weather data.';

  const currentSeason = getSeason();
  const currentMonth = new Date().toLocaleString('en-US', { month: 'long' });

  // Block 2: profile + wardrobe — cached separately so it hits cache
  // even when occasion/weather changes between calls
  const profileBlock = `━━ PERSON PROFILE ━━
Name: ${profile.display_name || 'User'}
Body type: ${profile.body_type || 'not specified'}
Skin tone: ${profile.skin_tone || 'not specified'}
Style vibe: ${(profile.style_vibe || []).join(', ') || 'not specified'}
Hair type: ${profile.hair_type || 'not specified'}, Length: ${profile.hair_length || 'not specified'}
Hair tools: ${(profile.hair_styling_tools || []).join(', ') || 'not specified'}

━━ SEASON ━━
${currentSeason} ${new Date().getFullYear()}, ${currentMonth}

━━ WARDROBE ━━
${wardrobeText}`;

  const text = await callClaude({
    model: MODELS.smart,
    system: [
      // Block 1: static persona + format — almost never changes → long-lived cache hit
      { type: 'text', text: OUTFIT_PERSONA, cache_control: { type: 'ephemeral' } },
      // Block 2: profile + wardrobe — changes when wardrobe is edited → shorter cache window but still hits across same session
      { type: 'text', text: profileBlock, cache_control: { type: 'ephemeral' } },
    ],
    // User message: tiny — just occasion + weather. Not cached (changes every call).
    messages: [{ role: 'user', content:
      `Generate ${extraSuggestions ? '3 fresh alternative' : '3 perfect'} outfits for: ${occasion}${location ? ` at ${location}` : ''}.
Weather: ${weatherContext}
${weather?.alerts?.length ? `Alerts: ${weather.alerts.map(a => a.message).join(' | ')}` : ''}
${previousOutfitIds.length ? 'Avoid repeating previous suggestions.' : ''}
${location && /hike|trail|mountain|outdoor|park|camp/i.test(location) ? 'Outdoor activity — prioritize weather protection and appropriate footwear.' : ''}`
    }],
    max_tokens: 3000,
  });

  return parseClaudeJSON(text);
}

// ─── Couple outfit generation ─────────────────────────────────
const COUPLE_PERSONA = `You are Stylie — an elite couples stylist. Generate 3 coordinated couple outfit combinations.

COUPLE STYLING RULES:
- Outfits must COMPLEMENT each other — coordinated colors, matching vibe, same formality
- Do NOT match exactly (looks tacky) — complement, not clone
- Apply color harmony between both outfits
- Match energy: if he's smart casual, she shouldn't be in a ball gown
- Return ONLY valid JSON

{
  "couple_outfits": [
    {
      "name": "Couple look name",
      "vibe": "e.g. Coordinated Elegance",
      "his": { "items": [], "description": "", "styling_tip": "" },
      "her": { "items": [], "description": "", "styling_tip": "" },
      "why_together": "Why these two outfits work as a couple look",
      "color_story": "How the colors interact",
      "confidence": 8
    }
  ],
  "his_hair": { "suggestion": "", "how_to": "", "time_needed": "" },
  "her_hair": { "suggestion": "", "how_to": "", "time_needed": "" },
  "couple_tip": "One golden tip for looking great together"
}`;

export async function generateCoupleOutfits({ hisProfile, herProfile, hisWardrobe, herWardrobe, occasion, location, weather }) {
  Logger.info('Claude', 'Generating couple outfits', { occasion });

  const fmt = (items, name) => items.length > 0
    ? items.map(i => `  - ${i.name || i.category}: ${i.color} ${i.category}${i.brand ? ` (${i.brand})` : ''}`).join('\n')
    : `  (${name}'s wardrobe is empty)`;

  const weatherContext = weather ? `${weather.summary}\n${weather.dressingAdvice}` : 'Mild conditions.';

  const dataBlock = `OCCASION: ${occasion}${location ? ` at ${location}` : ''}
WEATHER: ${weatherContext}

HIS PROFILE: Body: ${hisProfile?.body_type}, Skin: ${hisProfile?.skin_tone}, Style: ${(hisProfile?.style_vibe||[]).join(', ')}
HIS WARDROBE:
${fmt(hisWardrobe, hisProfile?.display_name || 'His')}

HER PROFILE: Body: ${herProfile?.body_type}, Skin: ${herProfile?.skin_tone}, Style: ${(herProfile?.style_vibe||[]).join(', ')}
HER WARDROBE:
${fmt(herWardrobe, herProfile?.display_name || 'Her')}`;

  const text = await callClaude({
    model: MODELS.smart,
    system: [
      { type: 'text', text: COUPLE_PERSONA, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dataBlock, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: `Generate 3 coordinated couple outfit options for: ${occasion}` }],
    max_tokens: 3500,
  });
  return parseClaudeJSON(text);
}

// ─── Vacation planner ─────────────────────────────────────────
const VACATION_PERSONA = `You are Stylie — the personal stylist to A-list celebrities travelling internationally. You know exactly what locals wear in every city, what reads as "tourist", what opens doors at nice restaurants, and how to pack light but look incredible every day.

MISSION:
1. Capsule wardrobe plan — maximize outfits per item
2. Identify wardrobe gaps and recommend specific items to buy
3. Give real local style intelligence specific to the destination
4. Think like a celebrity stylist: elevate every look, suggest accessories

RULES:
- Wardrobe items: reference by exact name from the list
- Buy recommendations: specific (brand, item type, color, why it works)
- Local intel: specific to destination, not generic travel advice
- Return ONLY valid JSON

{
  "destination_intel": {
    "style_culture": "How locals dress — vibe, local vs tourist reads",
    "dress_codes": "Specific dress codes for restaurants, attractions, religious sites",
    "weather_expectation": "Expected weather and what it means for clothing",
    "fashion_scene": "What's trending locally",
    "what_to_avoid": "What marks you as a tourist or is out of place"
  },
  "packing_list": {
    "from_wardrobe": [{ "item": "exact name", "why": "why essential", "outfits_count": 3 }],
    "leave_behind": [{ "item": "exact name", "why": "why it doesn't work" }]
  },
  "day_outfits": [
    {
      "day": "Day 1 — Arrival",
      "occasion": "Travel day",
      "outfit": {
        "items": ["item names"],
        "description": "How it comes together",
        "styling_tip": "One tip to elevate it",
        "local_relevance": "Why this reads well in destination"
      }
    }
  ],
  "buy_recommendations": [
    {
      "item": "Specific item e.g. Slim-fit navy linen blazer",
      "brand_suggestions": ["Brand 1", "Brand 2"],
      "why": "Gap it fills + why perfect for this trip",
      "price_range": "$80–$150",
      "where_to_buy": "Best places to find this",
      "outfits_it_unlocks": ["Outfit description 1"]
    }
  ],
  "capsule_summary": "2-3 sentence packing strategy overview",
  "celebrity_tip": "One gold-standard celebrity stylist insight"
}`;

export async function planVacationOutfits({ profile, wardrobeItems, destination, startDate, endDate, activities }) {
  Logger.info('Claude', 'Planning vacation', { destination, startDate, endDate });

  const wardrobeText = wardrobeItems.length > 0
    ? wardrobeItems.map((i, idx) =>
        `[${idx}] ${i.name || i.category}: ${i.color} ${i.category}${i.fit ? `, ${i.fit} fit` : ''}${i.material ? `, ${i.material}` : ''}${i.brand ? ` (${i.brand})` : ''}`
      ).join('\n')
    : 'Wardrobe is empty — build the entire plan from expert recommendations.';

  const activityList = activities.length > 0 ? activities.join(', ') : 'general sightseeing and leisure';

  const dataBlock = `CLIENT: ${profile.display_name || 'Traveller'} | Body: ${profile.body_type || 'n/a'} | Skin: ${profile.skin_tone || 'n/a'} | Style: ${(profile.style_vibe || []).join(', ') || 'n/a'}

DESTINATION: ${destination}
DATES: ${startDate} → ${endDate}
ACTIVITIES: ${activityList}

WARDROBE:
${wardrobeText}`;

  const text = await callClaude({
    model: MODELS.smart,
    system: [
      { type: 'text', text: VACATION_PERSONA, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dataBlock, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: `Plan my complete vacation wardrobe for ${destination}, ${startDate} to ${endDate}. Activities: ${activityList}. Use my wardrobe where possible, fill gaps with specific buy recommendations, and give me real local style intel.` }],
    max_tokens: 4000,
  });
  return parseClaudeJSON(text);
}

function getSeason() {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return 'Spring';
  if (month >= 5 && month <= 7) return 'Summer';
  if (month >= 8 && month <= 10) return 'Fall';
  return 'Winter';
}

export { MODELS };
