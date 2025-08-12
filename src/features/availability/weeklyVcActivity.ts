import {
  AttachmentBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  TextChannel,
} from "discord.js";
import { Db } from "mongodb";
import { createCanvas } from "@napi-rs/canvas";

type VoiceEvent = {
  userId: string;
  username?: string | null;
  guildId: string | null;
  type: "join" | "leave";
  timestampMs: number;
};

type WeeklyStats = {
  matrix: number[][]; // [7][24] minutes per hour (UTC)
  topRegulars: Array<{
    userId: string;
    username: string;
    totalMinutes: number;
    avgJoinHourUtc: number | null; // [0,24)
  }>;
  maxCellMinutes: number;
  subtitle?: string;
};

export function scheduleWeeklyVcActivity(client: Client, db: Db) {
  const start = () => {
    // Kick off an immediate run for all guilds to ensure the message exists
    void runForAllGuilds(client, db);

    // Schedule daily runs at 08:00 America/New_York
    scheduleNextDailyRun(client, db);
  };

  if (client.isReady()) {
    start();
  } else {
    client.once("ready", start);
  }
}

function scheduleNextDailyRun(client: Client, db: Db) {
  const now = Date.now();
  const parts = toTimeZoneParts(new Date(now), "America/New_York");
  const today8amEtMs = fromTimeZoneComponents(
    "America/New_York",
    parts.year,
    parts.month,
    parts.day,
    8,
    0,
    0,
    0,
  );
  const targetEtMs = now < today8amEtMs ? today8amEtMs : addDaysEt(today8amEtMs, 1);
  const delayMs = Math.max(0, targetEtMs - now);

  setTimeout(async () => {
    try {
      await runForAllGuilds(client, db);
    } finally {
      // Chain the next daily run
      scheduleNextDailyRun(client, db);
    }
  }, delayMs);
}

async function runForAllGuilds(client: Client, db: Db) {
  const guilds = client.guilds.cache;
  for (const [, guild] of guilds) {
    try {
      await generateAndUpsertForGuild(client, db, guild);
    } catch (error) {
      console.error(`weeklyVcActivity: failed for guild ${guild.id}`, error);
    }
  }
}

async function generateAndUpsertForGuild(client: Client, db: Db, guild: Guild) {
  const now = Date.now();
  const { lastMondayStartEtMs, thisMondayStartEtMs } = getEtWeekBounds(now);
  // First try: last complete ET week
  let stats = await computeWeeklyStatsForGuild(db, guild.id, lastMondayStartEtMs, thisMondayStartEtMs);
  let subtitle = `${formatDateEt(new Date(lastMondayStartEtMs))}  →  ${formatDateEt(new Date(thisMondayStartEtMs))} (ET week)`;
  stats.subtitle = subtitle;
  let png = await renderWeeklyHeatmapPng(
    stats,
    lastMondayStartEtMs,
    thisMondayStartEtMs,
    subtitle,
  );

  // Fallback: if no data, show rolling last 7 days up to now
  if (stats.maxCellMinutes === 0) {
    const sevenDaysMs = 7 * 24 * 3600 * 1000;
    const startFallback = now - sevenDaysMs;
    stats = await computeWeeklyStatsForGuild(db, guild.id, startFallback, now);
    subtitle = `${formatDateEt(new Date(startFallback))} → ${formatDateEt(new Date(now))}`;
    stats.subtitle = subtitle;
    png = await renderWeeklyHeatmapPng(
      stats,
      startFallback,
      now,
      subtitle,
    );
  }

  const { channel, messageId } = await ensureVcActivityMessage(client, db, guild);

  const attachment = new AttachmentBuilder(Buffer.from(png), { name: `weekly-vc-activity.png` });

  if (messageId) {
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({
        content: ``,
        embeds: [buildEmbed(stats)],
        files: [attachment],
      });
    } catch (e) {
      // If the message is gone, post anew and update record
      const newMsg = await channel.send({
        embeds: [buildEmbed(stats)],
        files: [attachment],
      });
      await db.collection("vcActivityMessages").updateOne(
        { guildId: guild.id },
        { $set: { guildId: guild.id, channelId: channel.id, messageId: newMsg.id } },
        { upsert: true },
      );
    }
  } else {
    const newMsg = await channel.send({
      embeds: [buildEmbed(stats)],
      files: [attachment],
    });
    await db.collection("vcActivityMessages").updateOne(
      { guildId: guild.id },
      { $set: { guildId: guild.id, channelId: channel.id, messageId: newMsg.id } },
      { upsert: true },
    );
  }
}

function buildEmbed(stats: WeeklyStats) {
  const embed = new EmbedBuilder()
    .setTitle("Weekly VC Activity (EST)")
    .setDescription(stats.subtitle || "")
    .setImage("attachment://weekly-vc-activity.png")
    .setColor(0x2b6cb0);
  return embed;
}

function formatTopRegulars(list: WeeklyStats["topRegulars"]) {
  const top = list.slice(0, 5);
  return top
    .map((u, idx) => {
      const hours = (u.totalMinutes / 60).toFixed(1);
      const avg = u.avgJoinHourUtc == null ? "–" : toHhMm(u.avgJoinHourUtc);
      const name = u.username || u.userId;
      return `${idx + 1}. ${name} • ${hours}h • ${avg}`;
    })
    .join("\n");
}

async function ensureVcActivityMessage(client: Client, db: Db, guild: Guild): Promise<{ channel: TextChannel; messageId?: string }> {
  // Find or create channel
  let channel = guild.channels.cache.find(
    (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === "vc-activity",
  );
  if (!channel) {
    channel = await guild.channels.create({ name: "vc-activity", type: ChannelType.GuildText });
  }

  const existing = await db.collection("vcActivityMessages").findOne<{ guildId: string; channelId: string; messageId: string }>({ guildId: guild.id });
  if (existing && existing.channelId === channel.id) {
    return { channel, messageId: existing.messageId };
  }
  return { channel };
}

async function computeWeeklyStatsForGuild(db: Db, guildId: string, startMs: number, endMs: number): Promise<WeeklyStats> {
  const eventsColl = db.collection<VoiceEvent>("voiceEvents");

  // Initial state per user at start
  const lastBeforeCursor = eventsColl.aggregate([
    { $match: { guildId, timestampMs: { $lt: startMs } } },
    { $sort: { userId: 1 as any, timestampMs: -1 as any } },
    { $group: { _id: "$userId", lastEvent: { $first: "$$ROOT" } } },
  ]);
  const lastBefore: Record<string, VoiceEvent | undefined> = {};
  for await (const doc of lastBeforeCursor) {
    lastBefore[doc._id as string] = doc.lastEvent as VoiceEvent;
  }

  // All events during window
  const eventsDuring = await eventsColl
    .find({ guildId, timestampMs: { $gte: startMs, $lt: endMs } })
    .sort({ timestampMs: 1 })
    .toArray();

  // Build sessions per user
  type OpenState = { openAt: number; username: string } | undefined;
  const openByUser: Record<string, OpenState> = {};
  const usernameByUser: Record<string, string> = {};
  const sessions: Array<{ userId: string; start: number; end: number }> = [];

  // Initialize from lastBefore
  for (const [userId, ev] of Object.entries(lastBefore)) {
    if (ev && ev.type === "join") {
      openByUser[userId] = { openAt: startMs, username: ev.username || userId };
      usernameByUser[userId] = ev.username || userId;
    }
  }

  for (const ev of eventsDuring) {
    const userId = ev.userId;
    if (ev.username) {
      usernameByUser[userId] = ev.username;
    }
    const open = openByUser[userId];
    if (ev.type === "join") {
      if (!open) {
        openByUser[userId] = { openAt: ev.timestampMs, username: (ev.username || usernameByUser[userId] || userId) };
      } else {
        // Already open; ignore duplicate join
      }
    } else if (ev.type === "leave") {
      if (open) {
        const start = Math.max(open.openAt, startMs);
        const end = Math.min(ev.timestampMs, endMs);
        if (end > start) {
          sessions.push({ userId, start, end });
        }
        openByUser[userId] = undefined;
      } else {
        // Leave without open; ignore
      }
    }
  }

  // Close any remaining open sessions at endMs
  for (const [userId, open] of Object.entries(openByUser)) {
    if (open) {
      const start = Math.max(open.openAt, startMs);
      const end = endMs;
      if (end > start) {
        sessions.push({ userId, start, end });
      }
    }
  }

  // Aggregate into 7x24 matrix (UTC)
  const matrix: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  // Per-user totals and join-hour circular mean (based on join events in window)
  const totalMinutesByUser: Record<string, number> = {};
  const circByUser: Record<string, { x: number; y: number; n: number }> = {};

  // Accumulate sessions
  for (const s of sessions) {
    totalMinutesByUser[s.userId] = (totalMinutesByUser[s.userId] || 0) + Math.round((s.end - s.start) / 60000);
    accumulateSessionIntoMatrix(s.start, s.end, matrix);
  }

  // Join events within window for circular mean
  for (const ev of eventsDuring) {
    if (ev.type !== "join") continue;
    const utc = new Date(ev.timestampMs);
    const hour = utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600;
    const theta = (2 * Math.PI * hour) / 24;
    const u = circByUser[ev.userId] || { x: 0, y: 0, n: 0 };
    u.x += Math.cos(theta);
    u.y += Math.sin(theta);
    u.n += 1;
    circByUser[ev.userId] = u;
  }

  const topRegulars = Object.keys(totalMinutesByUser)
    .map((userId) => {
      const circ = circByUser[userId];
      let avgJoinHourUtc: number | null = null;
      if (circ && circ.n > 0) {
        const angle = Math.atan2(circ.y / circ.n, circ.x / circ.n); // [-pi, pi]
        const normalized = angle < 0 ? angle + 2 * Math.PI : angle;
        avgJoinHourUtc = (normalized * 24) / (2 * Math.PI);
      }
      return {
        userId,
        username: sanitizeUsername((usernameByUser[userId] as string) || userId),
        totalMinutes: totalMinutesByUser[userId],
        avgJoinHourUtc,
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
    .slice(0, 10);

  let maxCellMinutes = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (matrix[d][h] > maxCellMinutes) maxCellMinutes = matrix[d][h];
    }
  }

  return { matrix, topRegulars, maxCellMinutes };
}

function sanitizeUsername(name: string): string {
  if (!name) return "Unknown";
  return name.replace(/[`*_~|>\\]/g, "");
}

function accumulateSessionIntoMatrix(startMs: number, endMs: number, matrix: number[][]) {
  let cursor = startMs;
  while (cursor < endMs) {
    const cursorDate = new Date(cursor);
    const nextHour = Date.UTC(
      cursorDate.getUTCFullYear(),
      cursorDate.getUTCMonth(),
      cursorDate.getUTCDate(),
      cursorDate.getUTCHours() + 1,
      0,
      0,
      0,
    );
    const sliceEnd = Math.min(endMs, nextHour);
    const minutes = Math.ceil((sliceEnd - cursor) / 60000);
    const row = dayIndexUtc(cursorDate);
    const col = cursorDate.getUTCHours();
    matrix[row][col] += minutes;
    cursor = sliceEnd;
  }
}

function dayIndexUtc(d: Date): number {
  // 0=Mon..6=Sun
  return (d.getUTCDay() + 6) % 7;
}

async function renderWeeklyHeatmapPng(stats: WeeklyStats, startMs: number, endMs: number, subtitle: string): Promise<Uint8Array> {
  // Layout
  const cellW = 28;
  const cellH = 26;
  // Two 12-hour blocks (AM/PM) contiguous (no gap)
  const blockGap = 0;
  const blockW = 12 * cellW;
  const gridW = blockW * 2 + blockGap;
  const gridH = 7 * cellH;
  const leftMargin = 80;
  const topMargin = 60; // more compact since no header inside image
  const rightMargin = 40; // no legend, keep small padding
  const bottomMargin = 60;
  const width = leftMargin + gridW + rightMargin;
  const height = topMargin + gridH + bottomMargin;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Colors
  const pageBg = "#0f0f12";
  const gridBg = "#151a1f"; // slightly brighter than page background
  const gridLine = "#2d333b";

  // Background
  ctx.fillStyle = pageBg;
  ctx.fillRect(0, 0, width, height);

  // No title or subtitle inside the PNG; the embed carries them

  // Axes labels (with extra spacing to avoid overlap)
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "middle";
  for (let r = 0; r < 7; r++) {
    ctx.fillStyle = "#c9d1d9";
    ctx.fillText(weekdays[r], leftMargin - 58, topMargin + r * cellH + cellH / 2);
  }
  ctx.textBaseline = "alphabetic";
  // AM strip labels
  for (let c = 0; c < 12; c++) {
    if (c % 3 !== 0) continue;
    const x = leftMargin + c * cellW + cellW / 2;
    const hr = c === 0 ? 12 : c; // 12-hour format
    const label = `${hr}a`;
    const textW = ctx.measureText(label).width;
    ctx.fillStyle = "#c9d1d9";
    ctx.fillText(label, x - textW / 2, topMargin - 10);
  }
  // PM strip labels
  const pmOffset = leftMargin + blockW + blockGap;
  for (let c = 0; c < 12; c++) {
    if (c % 3 !== 0) continue;
    const x = pmOffset + c * cellW + cellW / 2;
    const hr = c === 0 ? 12 : c;
    const label = `${hr}p`;
    const textW = ctx.measureText(label).width;
    ctx.fillStyle = "#c9d1d9";
    ctx.fillText(label, x - textW / 2, topMargin - 10);
  }

  // Grid cells
  // Robust scaling: use P95 of non-zero cells as the scale maximum so outliers don't wash out the heatmap
  const allValues: number[] = [];
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 24; c++) if (stats.matrix[r][c] > 0) allValues.push(stats.matrix[r][c]);
  }
  allValues.sort((a, b) => a - b);
  const p95Index = allValues.length ? Math.floor(0.95 * (allValues.length - 1)) : -1;
  const scaleMax = allValues.length ? Math.max(1, allValues[p95Index]) : Math.max(1, stats.maxCellMinutes);
  const baseRgb = hexToRgb(gridBg);
  for (let r = 0; r < 7; r++) {
    // AM strip (0-11)
    for (let c = 0; c < 12; c++) {
      const v = stats.matrix[r][c];
      let t = v / scaleMax;
      const x = leftMargin + c * cellW;
      const y = topMargin + r * cellH;
      // Base cell background for zero values: gridBg
      ctx.fillStyle = v > 0 ? scalarToColor(Math.max(0, Math.min(1, t)), baseRgb) : gridBg;
      ctx.fillRect(x, y, cellW, cellH);
    }
    // PM strip (12-23)
    for (let c = 0; c < 12; c++) {
      const v = stats.matrix[r][12 + c];
      let t = v / scaleMax;
      const x = leftMargin + blockW + blockGap + c * cellW;
      const y = topMargin + r * cellH;
      ctx.fillStyle = v > 0 ? scalarToColor(Math.max(0, Math.min(1, t)), baseRgb) : gridBg;
      ctx.fillRect(x, y, cellW, cellH);
    }
  }

  // Grid lines
  ctx.strokeStyle = gridLine;
  ctx.lineWidth = 1;
  // Horizontal lines across both blocks
  for (let r = 0; r <= 7; r++) {
    const y = topMargin + r * cellH + 0.5;
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(leftMargin + gridW, y);
    ctx.stroke();
  }
  // Vertical lines AM block
  for (let c = 0; c <= 12; c++) {
    const x = leftMargin + c * cellW + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, topMargin);
    ctx.lineTo(x, topMargin + gridH);
    ctx.stroke();
  }
  // Vertical lines PM block
  for (let c = 0; c <= 12; c++) {
    const x = leftMargin + blockW + blockGap + c * cellW + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, topMargin);
    ctx.lineTo(x, topMargin + gridH);
    ctx.stroke();
  }

  // No legend; expand grid using the freed space already

  // No footer table

  // Encode to PNG
  return canvas.encode("png");
}

function scalarToColor(t: number, baseRgb?: [number, number, number]): string {
  // Clamp 0..1, perceptual boost toward higher brightness but strictly monotonic
  const x = Math.max(0, Math.min(1, t));
  const y = Math.pow(x, 0.7); // gamma for perceptual linearity

  // Target green increases in brightness and saturation with y
  const h = 140; // green
  const s = 0.7 + 0.25 * y; // 0.70 -> 0.95
  const l = 0.40 + 0.30 * y; // 0.40 -> 0.70 (monotonic brighter)
  const target = hslToRgb(h / 360, Math.min(0.95, s), Math.min(0.75, l));

  if (baseRgb) {
    // Blend from grid background to target; keep a small minimum blend for any non-zero to be distinguishable
    const blend = x === 0 ? 0 : 0.12 + 0.88 * y; // 0 -> 0, else 0.12..1
    const rr = Math.round(baseRgb[0] + (target[0] - baseRgb[0]) * blend);
    const gg = Math.round(baseRgb[1] + (target[1] - baseRgb[1]) * blend);
    const bb = Math.round(baseRgb[2] + (target[2] - baseRgb[2]) * blend);
    return `rgb(${rr}, ${gg}, ${bb})`;
  }
  return `rgb(${target[0]}, ${target[1]}, ${target[2]})`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h;
  const t = [hk + 1 / 3, hk, hk - 1 / 3];
  const rgb = t.map((tc) => {
    let c = tc;
    if (c < 0) c += 1;
    if (c > 1) c -= 1;
    if (c < 1 / 6) return p + (q - p) * 6 * c;
    if (c < 1 / 2) return q;
    if (c < 2 / 3) return p + (q - p) * (2 / 3 - c) * 6;
    return p;
  });
  return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const bigint = parseInt(v, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function toHhMm(hourFloat: number): string {
  let h = Math.floor(hourFloat) % 24;
  if (h < 0) h += 24;
  const m = Math.round((hourFloat - Math.floor(hourFloat)) * 60) % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function getEtWeekBounds(nowMs: number) {
  // Find the most recent Monday 00:00 in America/New_York time zone (ET) that is <= now
  const zoned = toTimeZoneParts(new Date(nowMs), "America/New_York");
  const day = zoned.weekday; // 0=Sun..6=Sat
  // We want Monday=1; compute delta days to get to Monday
  const daysSinceMonday = (day + 6) % 7; // Mon->0, Tue->1, ..., Sun->6
  const year = zoned.year;
  const month = zoned.month; // 1-12
  const date = zoned.day; // 1-31
  // Construct zoned time at local 00:00 today
  const todayMidnightEtMs = fromTimeZoneComponents("America/New_York", year, month, date, 0, 0, 0, 0);
  const thisMondayStartEtMs = todayMidnightEtMs - daysSinceMonday * 24 * 3600 * 1000;
  const lastMondayStartEtMs = thisMondayStartEtMs - 7 * 24 * 3600 * 1000;
  return { lastMondayStartEtMs, thisMondayStartEtMs };
}

function addDaysEt(etEpochMs: number, days: number): number {
  // Add days in ET local time, preserving wall-clock midnight
  const parts = toTimeZoneParts(new Date(etEpochMs), "America/New_York");
  const targetMs = fromTimeZoneComponents(
    "America/New_York",
    parts.year,
    parts.month,
    parts.day + days,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  return targetMs;
}

function formatDateEt(d: Date): string {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  return f.format(d);
}

function formatDateUtcShort(d: Date): string {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
  });
  return f.format(d);
}

function toTimeZoneParts(d: Date, timeZone: string) {
  // Uses Intl API to get calendar parts in a given time zone
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const res = {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    millisecond: 0,
    weekday: new Date(
      Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")),
    ).getUTCDay(), // 0=Sun..6=Sat in that local day
  };
  return res;
}

function fromTimeZoneComponents(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): number {
  // Convert local time-zone components to epoch ms by iteratively compensating the local offset
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const offset = tzOffsetMs(timeZone, guessUtc);
  return guessUtc - offset;
}

function tzOffsetMs(timeZone: string, utcTimestampMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcTimestampMs));
  const values: Record<string, number> = {} as any;
  for (const p of parts) if (p.type !== "literal") values[p.type] = Number(p.value);
  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );
  return asUtc - utcTimestampMs;
}


